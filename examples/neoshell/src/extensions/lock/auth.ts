import GLib from 'gi://GLib'
import { runWithInput } from '../../gjs/proc.js'

// Password checking without a PAM binding: unix_chkpwd is pam_unix's own
// setuid helper, and it lets a process verify the password of the user it
// runs as — exactly this case. The password goes to its stdin, NUL-terminated
// as pam_unix sends it, and the exit status is the verdict. It consults
// /etc/shadow only: a fingerprint reader or a U2F key set up through PAM is
// not in this path.

const HELPER = '/usr/bin/unix_chkpwd'

export interface AuthResult {
  ok: boolean
  error: string
}

export async function checkPassword(password: string): Promise<AuthResult> {
  if (password === '') {
    return { ok: false, error: 'empty password' }
  }
  const input = new TextEncoder().encode(`${password}\0`)
  const result = await runWithInput([HELPER, GLib.get_user_name(), 'nullok'], input)
  if (result.ok) {
    return { ok: true, error: '' }
  }
  if (result.stderr !== '') {
    return { ok: false, error: result.stderr }
  }
  return { ok: false, error: 'wrong password' }
}
