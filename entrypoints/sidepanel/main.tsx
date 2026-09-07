import './theme';
import './style.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import { Toaster } from './components/ui/sonner';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <Toaster richColors position="top-right" offset={{ top: '52px', right: '10px' }} />
  </React.StrictMode>,
);
