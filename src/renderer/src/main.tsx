import React from 'react'
import ReactDOM from 'react-dom/client'
import { enableMapSet } from 'immer'
import App from './App'
import './styles/globals.css'

// Required for Zustand/Immer to handle Set and Map in state
enableMapSet()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
