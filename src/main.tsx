import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './app/theme';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Element #root fehlt in index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
