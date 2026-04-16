import * as fs from 'fs/promises'
import * as path from 'path'
import { execFile } from 'child_process'

interface CertResult {
  key: Buffer
  cert: Buffer
}

function opensslInstallHint(): string {
  switch (process.platform) {
    case 'win32':
      return 'Install OpenSSL for Windows: https://slproweb.com/products/Win32OpenSSL.html\n' +
        '  Or via winget:  winget install ShiningLight.OpenSSL\n' +
        '  Or via choco:   choco install openssl'
    case 'darwin':
      return 'Install via Homebrew: brew install openssl'
    default:
      return 'Install via your package manager, e.g.: sudo apt install openssl'
  }
}

function checkOpenssl(): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('openssl', ['version'], { timeout: 5_000 }, (err) => {
      if (err) {
        reject(new Error(
          `OpenSSL is required for the HTTPS server but was not found.\n` +
          `  ${opensslInstallHint()}`
        ))
      } else {
        resolve()
      }
    })
  })
}

export async function ensureSelfSignedCert(sslDir: string): Promise<CertResult> {
  const keyPath = path.join(sslDir, 'key.pem')
  const certPath = path.join(sslDir, 'cert.pem')

  // Return existing cert if both files are readable and non-empty
  try {
    const [key, cert] = await Promise.all([
      fs.readFile(keyPath),
      fs.readFile(certPath),
    ])
    if (key.length > 0 && cert.length > 0) return { key, cert }
  } catch {
    // Files missing or unreadable — generate below
  }

  // Verify OpenSSL is available before attempting generation
  await checkOpenssl()

  // Ensure directory exists
  await fs.mkdir(sslDir, { recursive: true })

  // Generate self-signed cert via OpenSSL
  await new Promise<void>((resolve, reject) => {
    execFile('openssl', [
      'req', '-x509',
      '-newkey', 'ec',
      '-pkeyopt', 'ec_paramgen_curve:prime256v1',
      '-keyout', keyPath,
      '-out', certPath,
      '-days', '3650',
      '-nodes',
      '-subj', '/CN=Agent Desktop',
      '-addext', 'subjectAltName=IP:127.0.0.1,IP:::1,DNS:localhost',
    ], { timeout: 10_000 }, (err, _stdout, stderr) => {
      if (err) {
        const hint = stderr?.trim().slice(0, 200) || err.message
        reject(new Error(`Failed to generate SSL certificate: ${hint}`))
      } else {
        resolve()
      }
    })
  })

  // Read the generated files
  const [key, cert] = await Promise.all([
    fs.readFile(keyPath),
    fs.readFile(certPath),
  ])
  return { key, cert }
}
