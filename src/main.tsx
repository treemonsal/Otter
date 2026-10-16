import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './styles.css';
const refresh = registerSW({
  onNeedRefresh() {
    window.dispatchEvent(new Event('murmur-update'));
  },
  onOfflineReady() {
    window.dispatchEvent(new Event('murmur-offline-ready'));
  },
});
(window as any).murmurUpdate = refresh;
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
