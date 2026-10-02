# CKEditor 5 demo bundle

This builds the CKEditor 5 that `example.html` loads - the live example, the customiser preview
and the download on <https://fxplugins.codecogs.com/docs/ckeditor5.html>.

It exists because CKEditor 5's GPL licence key is only accepted on the **npm** distribution
channel. Loading their prebuilt `ckeditor5.js` from a CDN - or copying that same file out of the
package and serving it ourselves - is treated as the *cloud* channel, and the editor refuses to
start with `license-key-invalid-distribution-channel`. Bundling from npm sources with an ordinary
bundler is the supported way to use the GPL key, so that is what this does.

    npm install
    npm run build

`npm run build` writes `dist/eqneditor-ckeditor5-demo.js` and `dist/ckeditor5.css` (not
committed; the Dockerfile runs the same build).

The plugin itself, `@codecogs/fxeditor-ckeditor5`, is taken from `../plugin` via a `file:`
dependency, so a change there only needs a rebuild here - no publish to npm in between.
