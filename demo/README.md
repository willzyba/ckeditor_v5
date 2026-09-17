# CKEditor 5 demo bundle

This builds the editor shown on
<https://editor.codecogs.com/docs/2-CK_Editor_v5.php>.

It exists because CKEditor 5's GPL licence key is only accepted on the **npm**
distribution channel. Loading their prebuilt `ckeditor5.js` from a CDN - or
copying that same file out of the package and serving it ourselves - is treated
as the *cloud* channel, and the editor refuses to start with
`license-key-invalid-distribution-channel`. Bundling from npm sources with an
ordinary bundler is the supported way to use the GPL key, so that is what this
does.

It also pins the versions the documentation page's instructions quote, so the
demo and the instructions cannot drift apart.

    npm install
    npm run build

`npm run build` writes two files straight into the website's public directory:

  * `public/plugins/ckeditor5/eqneditor-ckeditor5-demo.js`
  * `public/plugins/ckeditor5/ckeditor5.css`

The plugin itself is taken from `../plugin` via a `file:`
dependency, so a change there only needs a rebuild here - no publish to npm in
between.
