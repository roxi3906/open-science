# Runtime relocation dependency

`conda-pack` 0.9.2 is vendored unmodified from the PyPI wheel identified in
`conda-pack-source.json`. Its BSD-3-Clause license and distribution metadata are retained.
Only its library API is used, with a final destination prefix and both ignore flags disabled.
No package is installed into or removed from a user's existing environment.

The caller uses a separate archive/extraction step so files are never hard-linked back to the
source. It rejects escaping archive links and residual old prefix bytes before committing data.
Setuptools is not loaded on this API path (`dest_prefix` disables the unpack executable generator).
