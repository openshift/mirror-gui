import React from 'react';
import ReactDOM from 'react-dom/client';
import axios from 'axios';
import '@patternfly/react-core/dist/styles/base.css';
import '@patternfly/patternfly/patternfly-addons.css';
import './app.css';
import App from './App';

axios.defaults.headers.common['X-Mirror-Gui-Request'] = '1';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
