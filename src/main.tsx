import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { applySavedBrand } from './lib/brand'

applySavedBrand()
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
