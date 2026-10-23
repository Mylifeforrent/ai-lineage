import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './index.css';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('缺少根节点 #root');

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
