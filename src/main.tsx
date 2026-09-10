import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { ToastProvider } from './hooks/useToast';
import { setupGlobalErrorHandlers } from './utils/clientLogger';

setupGlobalErrorHandlers();

const rootEl = document.getElementById('root')!;
// 移除首屏加载占位（避免 React 渲染期间出现闪烁）
rootEl.innerHTML = '';

ReactDOM.createRoot(rootEl).render(
  <ToastProvider>
    <App />
  </ToastProvider>
);
