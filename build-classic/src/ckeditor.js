/**
 * @license Copyright (c) 2003-2020, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.md or https://ckeditor.com/legal/ckeditor-oss-license
 */

// The editor creator to use.
import ClassicEditorBase from '@ckeditor/ckeditor5-editor-classic/src/classiceditor';

import Essentials from '@ckeditor/ckeditor5-essentials/src/essentials';
import Bold from '@ckeditor/ckeditor5-basic-styles/src/bold';
import Italic from '@ckeditor/ckeditor5-basic-styles/src/italic';
import Heading from '@ckeditor/ckeditor5-heading/src/heading';
import Paragraph from '@ckeditor/ckeditor5-paragraph/src/paragraph';

import Indent from '@ckeditor/ckeditor5-indent/src/indent';

import List from '@ckeditor/ckeditor5-list/src/list';

// Following are essential for CodeCogs Equation Editor
import Image from '@ckeditor/ckeditor5-image/src/image';
import MediaEmbed from '@ckeditor/ckeditor5-media-embed/src/mediaembed';
import EqnEditor5 from '@codecogs/eqneditor-ckeditor5/src/eqneditor5';

import UploadAdapter from '@ckeditor/ckeditor5-adapter-ckfinder/src/uploadadapter';
import Autoformat from '@ckeditor/ckeditor5-autoformat/src/autoformat';
import BlockQuote from '@ckeditor/ckeditor5-block-quote/src/blockquote';
import CKFinder from '@ckeditor/ckeditor5-ckfinder/src/ckfinder';

import EasyImage from '@ckeditor/ckeditor5-easy-image/src/easyimage';

import PasteFromOffice from '@ckeditor/ckeditor5-paste-from-office/src/pastefromoffice';

import Table from '@ckeditor/ckeditor5-table/src/table';
import TableToolbar from '@ckeditor/ckeditor5-table/src/tabletoolbar';
import TextTransformation from '@ckeditor/ckeditor5-typing/src/texttransformation';


import ImageCaption from '@ckeditor/ckeditor5-image/src/imagecaption';
import ImageStyle from '@ckeditor/ckeditor5-image/src/imagestyle';
import ImageToolbar from '@ckeditor/ckeditor5-image/src/imagetoolbar';
import ImageUpload from '@ckeditor/ckeditor5-image/src/imageupload';
import Link from '@ckeditor/ckeditor5-link/src/link';



export default class ClassicEditor extends ClassicEditorBase {}

// Plugins to include in the build.
ClassicEditor.builtinPlugins = [
	Essentials,
	Bold,
	Italic,
	Heading,

	Indent,

	List,

	Image,				/* Need by EqnEditor 5 */
	MediaEmbed,			/* Need by EqnEditor 5 */
	EqnEditor5,			/* Core of EqnEditor 5 */

	ImageCaption,
	ImageStyle,
	ImageToolbar,
	ImageUpload,

	UploadAdapter,
	Autoformat,
	BlockQuote,
	CKFinder,
/*	EasyImage,*/
	Link,
	
	Paragraph,
	PasteFromOffice,
	Table,
	TableToolbar,
	TextTransformation,
	
];

// Editor configuration.
ClassicEditor.defaultConfig = {
	toolbar: {
		items: [
			'undo',
			'redo',
			'|',
			'EqnEditor5',
			'heading',
			'|',
			'bold',
			'italic',
			'link',
			'bulletedList',
			'numberedList',
			'|',
			'indent',
			'outdent',
			'|',
			'imageUpload',
			'insertTable',
			'mediaEmbed'
		]
	},
	image: {
		toolbar: [
			'imageStyle:full',
			'imageStyle:side',
			'|',
			'imageTextAlternative'
		]
	},
	table: {
		contentToolbar: [
			'tableColumn',
			'tableRow',
			'mergeTableCells'
		]
	},
	// This value must be kept in sync with the language defined in webpack.config.js.
	language: 'en'
};