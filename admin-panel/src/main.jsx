import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Routes, Route } from 'react-router-dom';
import './index.css';
import Layout from './components/Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Finance from './pages/Finance.jsx';
import Orders from './pages/Orders.jsx';
import Topups from './pages/Topups.jsx';
import Purchases from './pages/Purchases.jsx';
import UsersPage from './pages/Users.jsx';
import Broadcast from './pages/Broadcast.jsx';
import Activity from './pages/Activity.jsx';
import SettingsPage from './pages/Settings.jsx';
import BotSettings from './pages/BotSettings.jsx';
import Channels from './pages/Channels.jsx';
import ConnectIssues from './pages/ConnectIssues.jsx';
import Promos from './pages/Promos.jsx';
import Analytics from './pages/Analytics.jsx';
import Login from './pages/Login.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <Routes>
        <Route path="login" element={<Login />} />
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="finance" element={<Finance />} />
          <Route path="orders" element={<Orders />} />
          <Route path="topups" element={<Topups />} />
          <Route path="purchases" element={<Purchases />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="broadcast" element={<Broadcast />} />
          <Route path="activity" element={<Activity />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="bot-settings" element={<BotSettings />} />
          <Route path="channels" element={<Channels />} />
          <Route path="connect-issues" element={<ConnectIssues />} />
          <Route path="promos" element={<Promos />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="*" element={<Dashboard />} />
        </Route>
      </Routes>
    </HashRouter>
  </React.StrictMode>,
);
