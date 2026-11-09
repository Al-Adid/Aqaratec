// Plain JS on purpose: Vercel's Node function builder type-checks any .ts
// file placed in /api using its own TypeScript resolution, which does not
// match this project's own (it treats Express's Request/Response as their
// bare generic shape, missing .headers/.query/etc — dozens of false
// errors). That compile silently produced a broken function bundle instead
// of failing the build, which is why every request 500'd.
//
// Importing the already-built, already-typechecked server bundle (produced
// by this project's own `esbuild` step — see package.json's "build" script,
// which `vercel.json`'s buildCommand runs) sidesteps that entirely: this
// file has nothing for Vercel's compiler to misinterpret.
import { createApp } from "../dist/index.js";

export default createApp();
