import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './globals.css'
import App from './App'
import Setup from './setup'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
    <StrictMode>
        {/* One renderer for both windows: the setup window loads it with #setup. */}
        {location.hash === '#setup' ? <Setup /> : <App />}
    </StrictMode>,
)
