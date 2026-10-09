import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// Always start the cinematic sequence from the very top, even after a reload mid-scroll.
if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
window.scrollTo(0, 0);

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
