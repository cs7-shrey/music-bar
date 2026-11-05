// Prints the notes for a release: `node scripts/release-notes.mjs v0.2.0`.
//
// What changed since the previous tag, from the commit summaries (see
// Commits in AGENTS.md): new features, fixes and speedups. Refactors, docs and
// build changes don't matter to someone downloading the app, so they're
// left out. Then how to install, which every release needs while the app
// is unsigned.

import { execFileSync } from 'child_process'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

const tag = process.argv[2]
if (!tag) {
    console.error('usage: node scripts/release-notes.mjs <tag>')
    process.exit(1)
}

let previous = null
try {
    previous = git('describe', '--tags', '--abbrev=0', `${tag}^`)
} catch {
    // The first release has no tag before it.
}

const GROUPS = { feat: 'New', fix: 'Fixes', perf: 'Faster' }

const sections = []
if (previous) {
    const byGroup = {}
    for (const summary of git('log', '--format=%s', `${previous}..${tag}`).split('\n')) {
        const match = summary.match(/^(\w+)(?:\([^)]*\))?!?: (.+)$/)
        if (!match || !GROUPS[match[1]]) continue
        const text = match[2].charAt(0).toUpperCase() + match[2].slice(1)
        ;(byGroup[GROUPS[match[1]]] ??= []).push(`- ${text}`)
    }
    for (const group of Object.values(GROUPS)) {
        if (byGroup[group]) sections.push(`## ${group}\n\n${byGroup[group].join('\n')}`)
    }
    if (sections.length === 0) sections.push('Small internal changes.')
} else {
    sections.push('The first release of Music Bar.')
}

sections.push(`## Install

1. Download the \`.dmg\` below and open it.
2. Drag **Music Bar** onto **Applications**.
3. Open Music Bar from Applications.

Needs a Mac with Apple silicon.`)

console.log(sections.join('\n\n'))
