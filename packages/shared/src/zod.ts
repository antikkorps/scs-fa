// The one place this package imports zod from. Every schema module takes `z` from
// here, so this runs before the first schema is built, in any bundle.
//
// Jitless: zod would otherwise probe `new Function("")` to compile faster
// validators. The probe is caught, but a strict CSP (the shop's, no
// 'unsafe-eval') reports it as a violation on every page. The interpreted
// path is plenty for the payloads we validate.
//
// The only file `package.json` lists under `sideEffects`: everywhere else the
// bundler may prune what is unused, and here it would drop the config call,
// resolving `z` straight to zod.

import { z } from "zod"

z.config({ jitless: true })

export { z }
