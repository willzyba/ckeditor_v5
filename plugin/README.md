@codecogs/ckeditor5-eqneditor5
==============================

This package was created by the [ckeditor5-package-generator](https://www.npmjs.com/package/ckeditor5-package-generator) package.

## Usage

Edit your CKEditor 5 initialisation script, so it resembles the following:

    // The main CK editor creator to use
    import ClassicEditorBase from '@ckeditor/ckeditor5-editor-classic/src/classiceditor';

    // Other imports...

    import Image from '@ckeditor/ckeditor5-image/src/image';
    import MediaEmbed from '@ckeditor/ckeditor5-media-embed/src/mediaembed';
    import EqnEditor5 from '@codecogs/eqneditor-ckeditor5/src/eqneditor5';

    ...

    export default class ClassicEditor extends ClassicEditorBase {}

    // Plugins to include in the build.
    ClassicEditor.builtinPlugins = [
      Essentials,
      Bold,
      Italic,
      Heading,
      Image,          /* Needed by EqnEditor 5 */
      MediaEmbed,     /* Needed by EqnEditor 5 */
      EqnEditor5      /* Core of EqnEditor 5 */
    ];

    // Editor configuration.
    ClassicEditor.defaultConfig = {
      toolbar: {
        items: [
          'EqnEditor5', /* Added fx button for EqnEditor 5 */
          'heading',
          '|',
          'bold',
          'italic',
          '|',
          'undo',
          'redo'
        ]
      },

      language: 'en'
    };
      ...

## License

The `@codecogs/ckeditor5-eqneditor5` package is available under [MIT license](https://opensource.org/licenses/MIT).

However, it is the default license of packages created by the [ckeditor5-package-generator](https://www.npmjs.com/package/ckeditor5-package-generator) package and it can be changed.
