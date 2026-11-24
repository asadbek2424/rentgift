"""TON helpers: addresses, nanoTON maths, TonConnect link validation and the optional hot wallet.

Address handling is adapted from gift-rent-check (src/marketapp_rent/addresses.py).
"""

from __future__ import annotations

import base64
import binascii
import json
import re
import time
from decimal import ROUND_UP, Decimal
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import httpx
from pytoniq_core import Address, Builder, Cell, StateInit, WalletMessage, WalletV4Data
from pytoniq_core.crypto.keys import mnemonic_is_valid, mnemonic_to_private_key
from pytoniq_core.crypto.signature import sign_message
from pytoniq_core.tlb.block import CurrencyCollection
from pytoniq_core.tlb.transaction import ExternalMsgInfo, InternalMsgInfo, MessageAny

NANO = Decimal(10) ** 9
_RAW = re.compile(r"(-?\d+):([0-9a-fA-F]{64})\Z")
_FRIENDLY = re.compile(r"[A-Za-z0-9_+/-]{48}\Z")


# --------------------------------------------------------------------------- addresses
def canonical_address(value: str) -> str:
    """Return ``workchain:hex`` for a mainnet address; raise ValueError otherwise."""
    if not isinstance(value, str):
        raise ValueError("TON address must be a string")
    value = value.strip()
    raw = _RAW.fullmatch(value)
    if raw:
        if int(raw[1]) not in {-1, 0}:
            raise ValueError("Unsupported TON workchain")
    else:
        if not _FRIENDLY.fullmatch(value):
            raise ValueError("Invalid TON address encoding")
        try:
            decoded = base64.b64decode(value.replace("+", "-").replace("/", "_"), altchars=b"-_", validate=True)
        except (ValueError, binascii.Error):
            raise ValueError("Invalid TON address encoding") from None
        if len(decoded) != 36 or decoded[0] not in {0x11, 0x51, 0x91, 0xD1}:
            raise ValueError("Invalid TON address flags")
        if decoded[34:] != binascii.crc_hqx(decoded[:34], 0).to_bytes(2, "big"):
            raise ValueError("Invalid TON address checksum")
        if decoded[0] & 0x80:
            raise ValueError("A mainnet TON address is required")
    try:
        return Address(value).to_str(is_user_friendly=False)
    except Exception:
        raise ValueError("Invalid TON address") from None


def same_address(a: str | None, b: str | None) -> bool:
    try:
        return bool(a and b) and canonical_address(a) == canonical_address(b)
    except ValueError:
        return False


def friendly(value: str) -> str:
    """Non-bounceable user-friendly form (what wallets show)."""
    return Address(canonical_address(value)).to_str(is_user_friendly=True, is_bounceable=False, is_url_safe=True)


# --------------------------------------------------------------------------- money
def nano_to_ton(nano: int | str) -> Decimal:
    return Decimal(int(nano)) / NANO


def ton_text(nano: int | str, places: int = 3) -> str:
    value = nano_to_ton(nano).quantize(Decimal(1).scaleb(-places), rounding=ROUND_UP)
    text = format(value, "f").rstrip("0").rstrip(".")
    return text or "0"


def transaction_total_nano(tx: dict) -> int:
    """Sum of all message amounts in a TonConnect-style transaction."""
    messages = tx.get("messages") if isinstance(tx, dict) else None
    if not isinstance(messages, list) or not messages:
        raise ValueError("Transaction has no messages")
    total = 0
    for message in messages:
        if not isinstance(message, dict) or not str(message.get("amount", "")).isdigit():
            raise ValueError("Transaction message amount is invalid")
        canonical_address(str(message.get("address", "")))
        total += int(message["amount"])
    return total


# --------------------------------------------------------------------------- TonConnect links
_TC_ALLOWED_SCHEMES = {"tc", "https", "http"}


def validate_tonconnect_url(value: str) -> str:
    """Accept a TonConnect universal/deep link copied from Fragment ("Connect TON").

    Valid links carry the protocol version ``v``, the dApp session ``id`` and the
    connect request ``r`` (JSON). Anything else is rejected before it reaches Marketapp.
    """
    if not isinstance(value, str):
        raise ValueError("link_invalid")
    value = value.strip()
    match = re.search(r"(tc://\S+|https?://\S+)", value)
    if not match:
        raise ValueError("link_invalid")
    url = match.group(1).rstrip(").,;'\"")
    if len(url) > 4096:
        raise ValueError("link_invalid")
    parts = urlsplit(url)
    if parts.scheme not in _TC_ALLOWED_SCHEMES:
        raise ValueError("link_invalid")
    query = parse_qs(parts.query)
    if not query.get("id") or not query.get("r") or not query.get("v"):
        raise ValueError("link_invalid")
    if not re.fullmatch(r"[0-9a-fA-F]{64}", query["id"][0]):
        raise ValueError("link_invalid")
    try:
        request = json.loads(query["r"][0])
    except ValueError:
        raise ValueError("link_invalid") from None
    manifest = request.get("manifestUrl", "") if isinstance(request, dict) else ""
    if "fragment.com" not in manifest:
        raise ValueError("link_not_fragment")
    return url


# --------------------------------------------------------------------------- hot wallet (V4R2)
WALLET_V4R2_CODE = Cell.one_from_boc(bytes.fromhex((Path(__file__).with_name("wallet_v4r2.hex")).read_text().strip()))
DEFAULT_WALLET_ID = 698983191


class HotWalletError(RuntimeError):
    pass


def _cell_from_b64(value: str | None) -> Cell | None:
    if not value:
        return None
    try:
        return Cell.one_from_boc(base64.b64decode(value))
    except Exception:
        raise HotWalletError("Invalid BoC in transaction message") from None


class HotWallet:
    """Wallet V4R2 controlled by the server. Signs exactly the messages Marketapp returns."""

    def __init__(self, mnemonic: str, toncenter_url: str = "https://toncenter.com", api_key: str = "",
                 transport: httpx.AsyncBaseTransport | None = None) -> None:
        words = mnemonic.split()
        if not mnemonic_is_valid(words):
            raise HotWalletError("HOT_WALLET_MNEMONIC is not a valid 24-word TON mnemonic")
        self.public_key, self._private_key = mnemonic_to_private_key(words)
        data = WalletV4Data(seqno=0, wallet_id=DEFAULT_WALLET_ID, public_key=self.public_key).serialize()
        self.state_init = StateInit(code=WALLET_V4R2_CODE, data=data)
        self.address = Address((0, self.state_init.serialize().hash))
        headers = {"X-API-Key": api_key} if api_key else {}
        self._http = httpx.AsyncClient(base_url=toncenter_url.rstrip("/"), headers=headers, timeout=20, transport=transport)

    async def close(self) -> None:
        await self._http.aclose()

    async def seqno(self) -> int:
        response = await self._http.post("/api/v2/runGetMethod", json={
            "address": self.address.to_str(), "method": "seqno", "stack": []})
        response.raise_for_status()
        result = response.json().get("result") or {}
        if result.get("exit_code") not in (0, 1):
            return 0  # wallet not deployed yet
        stack = result.get("stack") or []
        if not stack:
            return 0
        return int(stack[0][1], 16)

    def build_transfer(self, tx: dict, seqno: int, now: int | None = None) -> Cell:
        """Return the signed external message cell for a TonConnect-style transaction."""
        messages = tx.get("messages") or []
        if not 1 <= len(messages) <= 4:
            raise HotWalletError("V4 wallet can send 1-4 messages")
        valid_until = int(tx.get("validUntil") or 0)
        now = int(time.time()) if now is None else now
        if valid_until and valid_until < now:
            raise HotWalletError("Transaction already expired")
        valid_until = min(valid_until or now + 120, now + 300)
        wallet_messages = []
        for raw in messages:
            dest = Address(str(raw["address"]))
            init_cell = _cell_from_b64(raw.get("stateInit"))
            state_init = StateInit.deserialize(init_cell.begin_parse()) if init_cell else None
            info = InternalMsgInfo(True, dest.is_bounceable, False, None, dest,
                                   CurrencyCollection(grams=int(raw["amount"]), other=None), 0, 0, 0, 0)
            body = _cell_from_b64(raw.get("payload")) or Cell.empty()
            wallet_messages.append(WalletMessage(send_mode=3, message=MessageAny(info=info, init=state_init, body=body)))
        signing = Builder().store_uint(DEFAULT_WALLET_ID, 32)
        if seqno == 0:
            signing.store_bits("1" * 32)
        else:
            signing.store_uint(valid_until, 32)
        signing.store_uint(seqno, 32).store_uint(0, 8)
        for message in wallet_messages:
            signing.store_cell(message.serialize())
        signing_cell = signing.end_cell()
        body = Builder().store_bytes(sign_message(signing_cell.hash, self._private_key)).store_cell(signing_cell).end_cell()
        external = MessageAny(info=ExternalMsgInfo(None, self.address, 0),
                              init=self.state_init if seqno == 0 else None, body=body)
        return external.serialize()

    async def send(self, tx: dict) -> str:
        """Sign and broadcast; returns the external message BoC (base64)."""
        seqno = await self.seqno()
        boc = base64.b64encode(self.build_transfer(tx, seqno).to_boc()).decode()
        response = await self._http.post("/api/v2/sendBoc", json={"boc": boc})
        if response.status_code != 200 or not response.json().get("ok", False):
            raise HotWalletError(f"Broadcast failed (HTTP {response.status_code})")
        return boc
