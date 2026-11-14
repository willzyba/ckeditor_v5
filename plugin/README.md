# @codecogs/fxeditor-ckeditor5

[fxEditor](https://fxeditor.codecogs.com), CodeCogs' LaTeX equation editor, as a plugin for
[CKEditor 5](https://ckeditor.com/ckeditor-5/) (v42 or later). Authors build an equation in a
maths view or as LaTeX, and it goes into the document as MathML or as an image.

Full documentation, a live example and a design tool:
**[fxplugins.codecogs.com/docs/ckeditor5.html](https://fxplugins.codecogs.com/docs/ckeditor5.html)**

## Install

```bash
npm install ckeditor5 @codecogs/fxeditor-ckeditor5
```

## Use

Import it alongside your other CKEditor imports, add it to both `plugins` and `toolbar`, and give
it your fxEditor licence key. The Image plugins are needed only if equations may be inserted as
images.

```js
import { ClassicEditor, Essentials, Paragraph, Bold, Italic,
         Image, ImageInline, ImageToolbar, ImageTextAlternative } from 'ckeditor5';
import { eqnEditor5 } from '@codecogs/fxeditor-ckeditor5';
import 'ckeditor5/ckeditor5.css';

ClassicEditor.create( document.querySelector( '#editor' ), {
    licenseKey: 'GPL',                       // CKEditor's own licence
    plugins: [ Essentials, Paragraph, Bold, Italic,
               Image, ImageInline, ImageToolbar, ImageTextAlternative,
               eqnEditor5 ],
    toolbar: [ 'undo', 'redo', '|', 'bold', 'italic', '|', 'EqnEditor5' ],
    eqnEditor: {
        server: 'fxtex.codecogs.com',
        licence: 'fx_pk_your-key-here',      // fxEditor's licence, from the licence manager
        design: { colour: '#0f7a4d' }        // optional
    }
} );
```

That is the whole integration. The equation editor itself is fetched from `fxtex.codecogs.com`
the first time it is needed, so there is nothing further to bundle and you always get the current
editor. Double-click an equation in the document to edit it again.

## Options (`eqnEditor`)

| Option | |
|---|---|
| `server` | Where the equation editor is loaded from: `fxtex.codecogs.com`, or your own fxTeX Server. A bare host means https. |
| `licence` | Your fxEditor licence key. Without one, equations show why they cannot render. |
| `design` | How the editor looks - toolbar, colour, sizes, the predictor. Build one with the design tool on the [documentation page](https://fxplugins.codecogs.com/docs/ckeditor5.html#customise). |
| `renderUrl` | The service that draws equations inserted as images. Defaults to `https://latex.codecogs.com`. |

## Licence

MIT. CKEditor 5 is licensed separately, as is fxEditor - see the documentation.
