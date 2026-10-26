import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './globals.css'
import App from './App'
import Setup from './setup'
import Settings from './settings'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
    <StrictMode>
        {/* One renderer for every window: the setup window loads it with #setup
            on the first run and #settings after. */}
        {location.hash === '#setup' ? <Setup /> : location.hash === '#settings' ? <Settings /> : <App />}
    </StrictMode>,
)
