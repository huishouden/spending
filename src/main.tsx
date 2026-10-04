import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import { startI18n } from './i18n';
import './index.css';

// The service worker makes the app installable and keeps it working offline.
registerSW({ immediate: true });

// The language's messages load before the first render, so no English flashes.
void startI18n().finally(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
