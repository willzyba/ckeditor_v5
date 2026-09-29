/*
 * The CKEditor 5 instance shown on https://editor.codecogs.com/docs/2-CK_Editor_v5.php
 *
 * This is a real, ordinary CKEditor 5 integration: nothing here is special to the
 * documentation site except the two `eqnEditor` options at the bottom, which point the plugin
 * at this site's own copy of the Equation Editor so the demo always exercises the build the
 * page was served with.
 *
 * It is bundled rather than loaded from a CDN because CKEditor's GPL licence key is only valid
 * for the npm distribution channel - their prebuilt browser bundle refuses it with
 * "license-key-invalid-distribution-channel".
 *
 * Build with `npm run build` in ckeditor5-demo/, which writes the result straight into the
 * website's public directory.
 */

import {
    ClassicEditor, Essentials, Paragraph, Heading, Bold, Italic, Link, List, Indent,
    Image, ImageInline, ImageBlock, ImageToolbar, ImageCaption, ImageStyle, ImageTextAlternative,
    Table, TableToolbar, PasteFromOffice, Autoformat, BlockQuote,
} from 'ckeditor5';

import { eqnEditor5 } from '@codecogs/eqneditor-ckeditor5';

/**
 * Creates the demo editor.
 *
 * @param {string} selector  CSS selector for the element to turn into an editor.
 * @param {object} options   { server, licence, scriptUrl, cssUrl, view, insertAs } - passed through
 *                            to the plugin.
 */
export function createDemoEditor( selector, options = {} ) {
    return ClassicEditor.create( document.querySelector( selector ), {
        licenseKey: 'GPL',

        plugins: [
            Essentials, Paragraph, Heading, Bold, Italic, Link, List, Indent,
            Image, ImageInline, ImageBlock, ImageToolbar, ImageCaption, ImageStyle,
            ImageTextAlternative, Table, TableToolbar, PasteFromOffice, Autoformat, BlockQuote,
            eqnEditor5
        ],

        toolbar: [
            'undo', 'redo', '|', 'EqnEditor5', '|', 'heading', '|',
            'bold', 'italic', 'link', '|', 'bulletedList', 'numberedList', '|', 'insertTable'
        ],

        // An equation is an inline image whose alt text is its LaTeX, so the image toolbar's
        // "Change image text alternative" is genuinely useful here - it is how you read the
        // equation's own markup back out without reopening the editor.
        image: {
            toolbar: [ 'imageTextAlternative' ]
        },

        table: {
            contentToolbar: [ 'tableColumn', 'tableRow', 'mergeTableCells' ]
        },

        eqnEditor: {
            view: options.view || 'both',
            server: options.server,
            licence: options.licence,
            scriptUrl: options.scriptUrl,
            cssUrl: options.cssUrl,
            // 'url' (default), 'latex' or 'mathml'.
            insertAs: options.insertAs
        }
    } );
}

// Exposed as a global so the documentation page can call it from a plain inline script.
window.CodeCogsCKEditorDemo = { create: createDemoEditor };
