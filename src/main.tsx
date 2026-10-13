import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startUpdates } from '@huishouden/pwa-kit/update';
import App from './App.tsx';
import { startI18n } from './i18n';
import './index.css';

// The service worker makes the app installable and keeps it working offline. New versions install
// in the background and apply without reloading the page in use (kit ./update).
if (import.meta.env.PROD) startUpdates({ base: import.meta.env.BASE_URL });

// The language's messages load before the first render, so no English flashes.
void startI18n().finally(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
