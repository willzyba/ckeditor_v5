import ClassicEditor from '@ckeditor/ckeditor5-editor-classic/src/classiceditor';
import Paragraph from '@ckeditor/ckeditor5-paragraph/src/paragraph';
import Heading from '@ckeditor/ckeditor5-heading/src/heading';
import Essentials from '@ckeditor/ckeditor5-essentials/src/essentials';
import Image from '@ckeditor/ckeditor5-image/src/image';
import MediaEmbed from '@ckeditor/ckeditor5-media-embed/src/mediaembed';

import Eqneditor5 from '../src/eqneditor5';

/* global document, window */

ClassicEditor
	.create( document.querySelector( '#editor' ), {
		plugins: [
			Eqneditor5,
			Paragraph,
			Heading,
			Essentials,
			Image,
			MediaEmbed
		],
		toolbar: [
			'eqneditor5',
			'|',
			'heading',
			'|',
			'undo',
			'redo'
		]
	} )
	.then( editor => {
		window.editor = editor;
		window.console.log( 'CKEditor 5 is ready.', editor );
	} )
	.catch( err => {
		window.console.error( err.stack );
	} );
