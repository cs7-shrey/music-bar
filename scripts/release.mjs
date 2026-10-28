// Cuts a release: `pnpm release <patch|minor|major|x.y.z>`.
//
// Bumps the version in package.json, commits it, tags the commit vX.Y.Z and
// pushes both. The tag starts .github/workflows/release.yml, which builds the
// DMG and publishes the GitHub release.

import { execFileSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import { createInterface } from 'readline/promises'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

function fail(message) {
    console.error(`release: ${message}`)
    process.exit(1)
}

function nextVersion(current, bump) {
    if (/^\d+\.\d+\.\d+$/.test(bump)) return bump
    const [major, minor, patch] = current.split('.').map(Number)
    if (bump === 'patch') return `${major}.${minor}.${patch + 1}`
    if (bump === 'minor') return `${major}.${minor + 1}.0`
    if (bump === 'major') return `${major + 1}.0.0`
    fail('usage: pnpm release <patch|minor|major|x.y.z>')
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const version = nextVersion(pkg.version, process.argv[2])
const tag = `v${version}`

// Release only what's on GitHub's main, with nothing half-done mixed in.
if (git('branch', '--show-current') !== 'main') fail('switch to main first')
if (git('status', '--porcelain')) fail('commit or stash your changes first')
git('fetch', '--quiet', '--tags', 'origin', 'main')
if (git('rev-list', '--count', 'HEAD..origin/main') !== '0') fail('main is behind origin; pull first')
if (git('tag', '--list', tag)) fail(`${tag} already exists`)

const prompt = createInterface({ input: process.stdin, output: process.stdout })
const answer = await prompt.question(`Release ${tag} (now ${pkg.version})? [y/N] `)
prompt.close()
if (answer.trim().toLowerCase() !== 'y') fail('cancelled')

// The build would catch a type error too, but only after the tag is public.
execFileSync('pnpm', ['typecheck'], { stdio: 'inherit' })

// Releasing the version package.json already has (the first release) needs
// no bump, so no commit.
if (version !== pkg.version) {
    pkg.version = version
    writeFileSync('package.json', JSON.stringify(pkg, null, 4) + '\n')
    git('commit', '--quiet', '-m', `chore(release): ${tag}`, 'package.json')
}
git('tag', '-a', tag, '-m', tag)
// Atomic: the commit and the tag land together or not at all.
git('push', '--quiet', '--atomic', 'origin', 'main', tag)

const repo = git('remote', 'get-url', 'origin').replace(/^git@github\.com:|^https:\/\/github\.com\//, '').replace(/\.git$/, '')
console.log(`\nPushed ${tag}. GitHub is building it:`)
console.log(`  https://github.com/${repo}/actions`)
console.log(`The release appears here when the build finishes (about 10 minutes):`)
console.log(`  https://github.com/${repo}/releases/tag/${tag}`)
