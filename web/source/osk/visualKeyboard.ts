/// <reference path="preProcessor.ts" />

namespace com.keyman.osk {
  let Codes = com.keyman.text.Codes;
  //#region Definition of the KeyElement merger type
  class KeyData {
    ['key']: OSKKey;
    ['keyId']: string;
    ['subKeys']?: OSKKeySpec[];

    constructor(keyData: OSKKey, keyId: string) {
      this['key'] = keyData;
      this['keyId'] = keyId;
    }
  }

  export type KeyElement = HTMLDivElement & KeyData;

  // Many thanks to https://www.typescriptlang.org/docs/handbook/advanced-types.html for this.
  function link(elem: HTMLDivElement, data: KeyData): KeyElement {
    let e = <KeyElement> elem;

    // Merges all properties and methods of KeyData onto the underlying HTMLDivElement, creating a merged class.
    for(let id in data) {
      if(!e.hasOwnProperty(id)) {
        (<any>e)[id] = (<any>data)[id];
      }
    }

    return e;
  }

  export function isKey(elem: Node): boolean {
    return elem && ('key' in elem) && ((<any> elem['key']) instanceof OSKKey);
  }

  export function getKeyFrom(elem: Node): KeyElement {
    if(isKey(elem)) {
      return <KeyElement> elem;
    } else {
      return null;
    }
  }
  //#endregion

  //#region OSK key objects and construction
  export class OSKKeySpec implements keyboards.LayoutKey {
    id: string;

    // Only set (within @keymanapp/keyboard-processor) for keys actually specified in a loaded layout
    baseKeyID?: string;
    coreID?: string;
    elementID?: string;

    text?: string;
    sp?: number | keyboards.ButtonClass;
    width: string;
    layer?: string; // The key will derive its base modifiers from this property - may not equal the layer on which it is displayed.
    nextlayer?: string;
    pad?: string;
    widthpc?: number; // Added during OSK construction.
    padpc?: number; // Added during OSK construction.
    sk?: OSKKeySpec[];

    constructor(id: string, text?: string, width?: string, sp?: number | keyboards.ButtonClass, nextlayer?: string, pad?: string) {
      this.id = id;
      this.text = text;
      this.width = width ? width : "50";
      this.sp = sp;
      this.nextlayer = nextlayer;
      this.pad = pad;
    }
  }

  export abstract class OSKKey {
    spec: OSKKeySpec;
    formFactor: string;

    /**
     * The layer of the OSK on which the key is displayed.
     */
    readonly layer: string;

    constructor(spec: OSKKeySpec, layer: string, formFactor: string) {
      this.spec = spec;
      this.layer = layer;
      this.formFactor = formFactor;
    }

    abstract getId(osk: VisualKeyboard): string;

    /**
     * Uses canvas.measureText to compute and return the width of the given text of given font in pixels.
     *
     * @param {String} text The text to be rendered.
     * @param {String} style The CSSStyleDeclaration for an element to measure against, without modification.
     *
     * @see https://stackoverflow.com/questions/118241/calculate-text-width-with-javascript/21015393#21015393
     * This version has been substantially modified to work for this particular application.
     */
    static getTextMetrics(osk: VisualKeyboard, text: string, style: {fontFamily?: string, fontSize: string}): TextMetrics {
      // A final fallback - having the right font selected makes a world of difference.
      if(!style.fontFamily) {
        style.fontFamily = getComputedStyle(document.body).fontFamily;
      }

      if(!style.fontSize || style.fontSize == "") {
        style.fontSize = '1em';
      }

      let fontFamily = style.fontFamily;

      // Use of `getComputedStyle` is ideal, but in many of our use cases its preconditions are not met.
      // The following allows us to calculate the font size in those situations.
      let emScale = osk.getKeyEmFontSize();
      let fontSpec = (<KeymanBase> window['keyman']).util.getFontSizeStyle(style.fontSize);

      var fontSize: string;
      if(fontSpec.absolute) {
        // We've already got an exact size - use it!
        fontSize = fontSpec.val + 'px';
      } else {
        fontSize = fontSpec.val * emScale + 'px';
      }

      // re-use canvas object for better performance
      var canvas: HTMLCanvasElement = OSKKey.getTextMetrics['canvas'] || 
                                     (OSKKey.getTextMetrics['canvas'] = document.createElement("canvas"));
      var context = canvas.getContext("2d");
      context.font = fontSize + " " + fontFamily;
      var metrics = context.measureText(text);

      return metrics;
    }

    getIdealFontSize(osk: VisualKeyboard, style: {height?: string, fontFamily?: string, fontSize: string}): string {
      // Recompute the new width for use in autoscaling calculations below, just in case.
      let util = com.keyman.singleton.util;
      let metrics = OSKKey.getTextMetrics(osk, this.spec.text, style);

      let fontSpec = util.getFontSizeStyle(style.fontSize);
      let keyWidth = this.getKeyWidth(osk);
      const MAX_X_PROPORTION = 0.90;
      const MAX_Y_PROPORTION = 0.90;
      const X_PADDING = 2;
      const Y_PADDING = 2;

      var fontHeight: number, keyHeight: number;
      if(metrics.fontBoundingBoxAscent) {
        fontHeight = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
      }

      let textHeight = fontHeight ? fontHeight + Y_PADDING : 0;
      if(style.height && style.height.indexOf('px') != -1) {
        keyHeight = Number.parseFloat(style.height.substring(0, style.height.indexOf('px')));
      }

      let xProportion = (keyWidth * MAX_X_PROPORTION) / (metrics.width + X_PADDING); // How much of the key does the text want to take?
      let yProportion = textHeight && keyHeight ? (keyHeight * MAX_Y_PROPORTION) / textHeight : undefined;

      var proportion: number = xProportion;
      if(yProportion && yProportion < xProportion) {
        proportion = yProportion;
      }

      // Never upscale keys past the default - only downscale them.
      // Proportion < 1:  ratio of key width to (padded [loosely speaking]) text width
      //                  maxProportion determines the 'padding' involved.
      if(proportion < 1) {
        if(fontSpec.absolute) {
          return proportion * fontSpec.val + 'px';
        } else {
          return proportion * fontSpec.val + 'em';
        }
      }
    }

    getKeyWidth(osk: VisualKeyboard): number {
      let units = this.objectUnits(osk.isStatic);

      if(units == 'px') {
        // For mobile devices, we presently specify width directly in pixels.  Just use that!
        return this.spec['widthpc'];
      } else if(units == '%') {
        // For desktop devices, each key is given a %age of the total OSK width.  We'll need to compute an
        // approximation for that.  `this.kbdDiv` is the element controlling the OSK's width, set in px.

        // This is an approximation that tends to be a bit too large, but it's close enough to be useful.
        return Math.floor(osk.width * this.spec['widthpc'] / 100);
      }
    }

    objectUnits(isStatic: boolean): string {
      // Returns a unit string corresponding to how the width for each key is specified.
      if(this.formFactor == 'desktop' || isStatic) {
        return '%';
      } else {
        return 'px';
      }
    }

    /**
     * Replace default key names by special font codes for modifier keys
     *
     *  @param  {string}  oldText
     *  @return {string}
     **/
    protected renameSpecialKey(oldText: string, osk: VisualKeyboard): string {
      let keyman = (<KeymanBase>window['keyman'])
      // If a 'special key' mapping exists for the text, replace it with its corresponding special OSK character.
      switch(oldText) {
        case '*ZWNJ*':
          // Default ZWNJ symbol comes from iOS.  We'd rather match the system defaults where
          // possible / available though, and there's a different standard symbol on Android.
          oldText = keyman.util.device.coreSpec.OS == com.keyman.utils.OperatingSystem.Android ?
            '*ZWNJAndroid*' :
            '*ZWNJiOS*';
          break;
        case '*Enter*':
          oldText = osk.isRTL ? '*RTLEnter*' : '*LTREnter*';
          break;
        case '*BkSp*':
          oldText = osk.isRTL ? '*RTLBkSp*' : '*LTRBkSp*';
          break;
        default:
          // do nothing.
      }

      let specialCodePUA = 0XE000 + VisualKeyboard.specialCharacters[oldText];

      return VisualKeyboard.specialCharacters[oldText] ?
        String.fromCharCode(specialCodePUA) :
        oldText;
    }

    // Produces a HTMLSpanElement with the key's actual text.
    protected generateKeyText(osk: VisualKeyboard): HTMLSpanElement {
      let util = (<KeymanBase>window['keyman']).util;
      let spec = this.spec;

      // Add OSK key labels
      var keyText;
      var t=util._CreateElement('span'), ts=t.style;
      if(spec['text'] == null || spec['text'] == '') {
        keyText='\xa0';  // default:  nbsp.
        if(typeof spec['id'] == 'string') {
          // If the ID's Unicode-based, just use that code.
          if(/^U_[0-9A-F]{4}$/i.test(spec['id'])) {
            keyText=String.fromCharCode(parseInt(spec['id'].substr(2),16));
          }
        }
      } else {
        keyText=spec['text'];

        // Unique layer-based transformation:  SHIFT-TAB uses a different glyph.
        if(keyText == '*Tab*' && this.layer == 'shift') {
          keyText = '*TabLeft*';
        }
      }

      t.className='kmw-key-text';

      let specialText = this.renameSpecialKey(keyText, osk);
      if(specialText != keyText) {
        // The keyboard wants to use the code for a special glyph defined by the SpecialOSK font.
        keyText = specialText;
        spec['font'] = "SpecialOSK";
      }

      // Grab our default for the key's font and font size.
      ts.fontSize=osk.fontSize;     //Build 344, KMEW-90

      //Override font spec if set for this key in the layout
      if(typeof spec['font'] == 'string' && spec['font'] != '') {
        ts.fontFamily=spec['font'];
      }

      if(typeof spec['fontsize'] == 'string' && spec['fontsize'] != '') {
        ts.fontSize=spec['fontsize'];
      }

      // For some reason, fonts will sometimes 'bug out' for the embedded iOS page if we
      // instead assign fontFamily to the existing style 'ts'.  (Occurs in iOS 12.)
      let styleSpec: {fontFamily?: string, fontSize: string} = {fontSize: ts.fontSize};

      if(ts.fontFamily) {
        styleSpec.fontFamily = ts.fontFamily;
      } else {
        styleSpec.fontFamily = osk.fontFamily; // Helps with style sheet calculations.
      }

      // Check the key's display width - does the key visualize well?
      var width: number = OSKKey.getTextMetrics(osk, keyText, styleSpec).width;
      if(width == 0 && keyText != '' && keyText != '\xa0') {
        // Add the Unicode 'empty circle' as a base support for needy diacritics.

        // Disabled by mcdurdin 2020-10-19; dotted circle display is inconsistent on iOS/Safari
        // at least and doesn't combine with diacritic marks. For consistent display, it may be
        // necessary to build a custom font that does not depend on renderer choices for base
        // mark display -- e.g. create marks with custom base included, potentially even on PUA
        // code points and use those in rendering the OSK. See #3039 for more details.
        // keyText = '\u25cc' + keyText;

        if(osk.isRTL) {
          // Add the RTL marker to ensure it displays properly.
          keyText = '\u200f' + keyText;
        }
      }

      ts.fontSize = this.getIdealFontSize(osk, styleSpec);

      // Finalize the key's text.
      t.innerHTML = keyText;

      return t;
    }
  }

  export class OSKBaseKey extends OSKKey {
    constructor(spec: OSKKeySpec, layer: string, formFactor: string) {
      super(spec, layer, formFactor);
    }

    getId(osk: VisualKeyboard): string {
      // Define each key element id by layer id and key id (duplicate possible for SHIFT - does it matter?)
      return this.spec.elementID;
    }

    // Produces a small reference label for the corresponding physical key on a US keyboard.
    private generateKeyCapLabel(): HTMLDivElement {
      // Create the default key cap labels (letter keys, etc.)
      var x = Codes.keyCodes[this.spec.baseKeyID];
      switch(x) {
        // Converts the keyman key id code for common symbol keys into its representative ASCII code.
        // K_COLON -> K_BKQUOTE
        case 186: x=59; break;
        case 187: x=61; break;
        case 188: x=44; break;
        case 189: x=45; break;
        case 190: x=46; break;
        case 191: x=47; break;
        case 192: x=96; break;
        // K_LBRKT -> K_QUOTE
        case 219: x=91; break;
        case 220: x=92; break;
        case 221: x=93; break;
        case 222: x=39; break;
        default:
          // No other symbol character represents a base key on the standard QWERTY English layout.
          if(x < 48 || x > 90) {
            x=0;
          }
      }

      if(x > 0) {
        let q = (<KeymanBase>window['keyman']).util._CreateElement('div');
        q.className='kmw-key-label';
        q.innerHTML=String.fromCharCode(x);
        return q;
      } else {
        // Keyman-only virtual keys have no corresponding physical key.
        return null;
      }
    }

    private processSubkeys(btn: KeyElement, osk: VisualKeyboard) {
      // Add reference to subkey array if defined
      var bsn: number, bsk=btn['subKeys'] = this.spec['sk'];
      // Transform any special keys into their PUA representations.
      for(bsn=0; bsn<bsk.length; bsn++) {
        if(bsk[bsn]['sp'] == '1' || bsk[bsn]['sp'] == '2') {
          var oldText=bsk[bsn]['text'];
          bsk[bsn]['text']=this.renameSpecialKey(oldText, osk);
        }

        // If a subkey doesn't have a defined layer property, copy it from the base key's layer by default.
        if(!bsk[bsn].layer) {
          bsk[bsn].layer = btn.key.layer
        }
      }

      // If a subkey array is defined, add an icon
      var skIcon=(<KeymanBase>window['keyman']).util._CreateElement('div');
      skIcon.className='kmw-key-popup-icon';
      //kDiv.appendChild(skIcon);
      btn.appendChild(skIcon);
    }

    construct(osk: VisualKeyboard, layout: keyboards.LayoutFormFactor, rowStyle: CSSStyleDeclaration, totalPercent: number): {element: HTMLDivElement, percent: number} {
      let util = com.keyman.singleton.util;
      let spec = this.spec;
      let isDesktop = this.formFactor == "desktop"

      let kDiv=util._CreateElement('div');
      kDiv.className='kmw-key-square';

      let ks=kDiv.style;
      ks.width=this.objectGeometry(spec['widthpc'], osk.isStatic);

      let originalPercent = totalPercent;

      let btnEle=util._CreateElement('div');
      let btn = link(btnEle, new KeyData(this, spec['id']));

      // Set button class
      osk.setButtonClass(spec,btn,layout);

      // Set key and button positioning properties.
      if(!isDesktop) {
        // Regularize interkey spacing by rounding key width and padding (Build 390)
        ks.left=this.objectGeometry(totalPercent+spec['padpc'], osk.isStatic);
        if(!osk.isStatic) {
          ks.bottom=rowStyle.bottom;
        }
        ks.height=rowStyle.height;  // must be specified in px for rest of layout to work correctly

        if(!osk.isStatic) {
          // Set distinct phone and tablet button position properties
          btn.style.left=ks.left;
          btn.style.width=ks.width;
        }
      } else {
        ks.marginLeft=this.objectGeometry(spec['padpc'], osk.isStatic);
      }

      totalPercent=totalPercent+spec['padpc']+spec['widthpc'];

      // Add the (US English) keycap label for layouts requesting display of underlying keys
      if(layout["displayUnderlying"]) {
        let keyCap = this.generateKeyCapLabel();

        if(keyCap) {
          btn.appendChild(keyCap);
        }
      }

      // Define each key element id by layer id and key id (duplicate possible for SHIFT - does it matter?)
      btn.id=this.getId(osk);

      // Define callbacks to handle key touches: iOS and Android tablets and phones
      // TODO: replace inline function calls??
      if(!osk.isStatic && !osk.device.touchable) {
        // Highlight key while mouse down or if moving back over originally selected key
        btn.onmouseover=btn.onmousedown=osk.mouseOverMouseDownHandler; // Build 360

        // Remove highlighting when key released or moving off selected element
        btn.onmouseup=btn.onmouseout=osk.mouseUpMouseOutHandler; //Build 360
      }

      // Make sure the key text is the element's first child - processSubkeys()
      // will add an extra element if subkeys exist, which can interfere with
      // keyboard/language name display on the space bar!
      btn.appendChild(this.generateKeyText(osk));

      // Handle subkey-related tasks.
      if(typeof(spec['sk']) != 'undefined' && spec['sk'] != null) {
        this.processSubkeys(btn, osk);
      } else {
        btn['subKeys']=null;
      }

      // Add text to button and button to placeholder div
      kDiv.appendChild(btn);

      // Prevent user selection of key captions
      //t.style.webkitUserSelect='none';

      // The 'return value' of this process.
      return {element: kDiv, percent: totalPercent - originalPercent};
    }

    objectGeometry(v: number, isStatic: boolean): string {
      let unit = this.objectUnits(isStatic);
      if(unit == '%') {
        return v + unit;
      } else { // unit == 'px'
        return (Math.round(v*100)/100)+unit; // round to 2 decimal places, making css more readable
      }
    }
  }

  export class OSKSubKey extends OSKKey {
    constructor(spec: OSKKeySpec, layer: string, formFactor: string) {
      super(spec, layer, formFactor);
    }

    getId(osk: VisualKeyboard): string {
      let spec = this.spec;
      let core = com.keyman.singleton.core;
      // Create (temporarily) unique ID by prefixing 'popup-' to actual key ID
      if(typeof(this.layer) == 'string' && this.layer != '') {
        return 'popup-'+this.layer+'-'+spec['id'];
      } else {
        // We only create subkeys when they're needed - the currently-active layer should be fine.
        return 'popup-' + core.keyboardProcessor.layerId + '-'+spec['id'];
      }
    }

    construct(osk: VisualKeyboard, baseKey: KeyElement, topMargin: boolean): HTMLDivElement {
      let spec = this.spec;

      let kDiv=document.createElement('div');
      let tKey = osk.getDefaultKeyObject();
      let ks=kDiv.style;

      for(var tp in tKey) {
        if(typeof spec[tp] != 'string') {
          spec[tp]=tKey[tp];
        }
      }

      kDiv.className='kmw-key-square-ex';
      if(topMargin) {
        ks.marginTop='5px';
      }

      if(typeof spec['width'] != 'undefined') {
        ks.width=(parseInt(spec['width'],10)*baseKey.offsetWidth/100)+'px';
      } else {
        ks.width=baseKey.offsetWidth+'px';
      }
      ks.height=baseKey.offsetHeight+'px';

      let btnEle=document.createElement('div');
      let btn = link(btnEle, new KeyData(this, spec['id']));

      osk.setButtonClass(spec,btn);
      btn.id = this.getId(osk);

      // Must set button size (in px) dynamically, not from CSS
      let bs=btn.style;
      bs.height=ks.height;
      bs.lineHeight=baseKey.style.lineHeight;
      bs.width=ks.width;

      // Must set position explicitly, at least for Android
      bs.position='absolute';

      btn.appendChild(this.generateKeyText(osk));
      kDiv.appendChild(btn);

      return kDiv;
    }
  }

  //#endregion

  export class VisualKeyboard {
    // Defines the PUA code mapping for the various 'special' modifier/control keys on keyboards.
    // `specialCharacters` must be kept in sync with the same variable in builder.js. See also CompileKeymanWeb.pas: CSpecialText10
    static specialCharacters = {
      '*Shift*':    8,
      '*Enter*':    5,
      '*Tab*':      6,
      '*BkSp*':     4,
      '*Menu*':     11,
      '*Hide*':     10,
      '*Alt*':      25,
      '*Ctrl*':     1,
      '*Caps*':     3,
      '*ABC*':      16,
      '*abc*':      17,
      '*123*':      19,
      '*Symbol*':   21,
      '*Currency*': 20,
      '*Shifted*':  8, // set SHIFTED->9 for filled arrow icon
      '*AltGr*':    2,
      '*TabLeft*':  7,
      '*LAlt*':     0x56,
      '*RAlt*':     0x57,
      '*LCtrl*':    0x58,
      '*RCtrl*':    0x59,
      '*LAltCtrl*':       0x60,
      '*RAltCtrl*':       0x61,
      '*LAltCtrlShift*':  0x62,
      '*RAltCtrlShift*':  0x63,
      '*AltShift*':       0x64,
      '*CtrlShift*':      0x65,
      '*AltCtrlShift*':   0x66,
      '*LAltShift*':      0x67,
      '*RAltShift*':      0x68,
      '*LCtrlShift*':     0x69,
      '*RCtrlShift*':     0x70,
      // Added in Keyman 14.0.
      '*LTREnter*':       0x05, // Default alias of '*Enter*'.
      '*LTRBkSp*':        0x04, // Default alias of '*BkSp*'.
      '*RTLEnter*':       0x71,
      '*RTLBkSp*':        0x72,
      '*ShiftLock*':      0x73,
      '*ShiftedLock*':    0x74,
      '*ZWNJ*':           0x75, // If this one is specified, auto-detection will kick in.
      '*ZWNJiOS*':        0x75, // The iOS version will be used by default, but the
      '*ZWNJAndroid*':    0x76, // Android platform has its own default glyph.
    };

    /**
     * Contains layout properties corresponding to the OSK's layout.  Needs to be public
     * so that its geometry may be updated on rotations and keyboard resize events, as
     * said geometry needs to be accurate for fat-finger probability calculations.
     */
    layout: keyboards.ActiveLayout;
    layers: keyboards.LayoutLayer[];
    private layerId: string = "default";
    readonly isRTL: boolean;
    layerIndex: number;

    device: Device;
    isStatic: boolean = false;

    // Stores the base element for this instance of the visual keyboard.
    // Formerly known as osk._DivVKbd
    kbdDiv: HTMLDivElement;
    kbdHelpDiv: HTMLDivElement;
    styleSheet: HTMLStyleElement;

    _width: number;
    _height: number;

    // Style-related properties
    fontFamily: string;
    fontSize: string;

    // State-related properties
    ddOSK: boolean = false;
    popupVisible: boolean;
    keyPending: KeyElement;
    touchPending: Touch;
    deleteKey: KeyElement;
    deleting: number; // Tracks a timer id for repeated deletions.
    nextLayer: string;
    currentKey: string;

    // Special keys (for the currently-visible layer)
    lgKey: KeyElement;
    hkKey: KeyElement; // hide keyboard key
    spaceBar: KeyElement;

    // Touch-tracking properties
    touchX: number;
    touchY: number;
    touchCount: number;
    currentTarget: KeyElement;

    // Popup key management
    popupBaseKey: KeyElement;
    popupPending: boolean = false;
    subkeyDelayTimer: number;
    popupDelay: number = 500;
    menuEvent: KeyElement; // Used by embedded-mode.
    keytip: {key: KeyElement, state: boolean, element?: HTMLDivElement};
    popupCallout: HTMLDivElement;

    //#region OSK constructor and helpers

    /**
     * @param       {Object}      PVK         Visual keyboard name
     * @param       {Object}      Lhelp       true if OSK defined for this keyboard
     * @param       {Object}      layout0
     * @param       {Number}      kbdBitmask  Keyboard modifier bitmask
     * Description  Generates the base visual keyboard element, prepping for attachment to KMW
     */
    constructor(keyboard: keyboards.Keyboard, device?: Device, isStatic?: boolean) {
      let keyman = com.keyman.singleton;
      // Ensure the OSK's current layer is kept up to date.
      keyman.core.keyboardProcessor.layerStore.handler = this.layerChangeHandler;

      let util = keyman.util;
      this.device = device = device || util.device;
      if(isStatic) {
        this.isStatic = isStatic;
      }

      // Create the collection of HTML elements from the device-dependent layout object
      var Lkbd=util._CreateElement('div');
      let layout: keyboards.ActiveLayout;
      if(keyboard) {
        layout = this.layout = keyboard.layout(device.formFactor as utils.FormFactor);
        this.isRTL = keyboard.isRTL;
      } else {
        // This COULD be called with no backing keyboard; KMW will try to force-show the OSK even without
        // a backing keyboard on mobile, using the most generic default layout as the OSK's base.
        //
        // In KMW's current state, it'd take a major break, though - Processor always has an activeKeyboard,
        // even if it's "hollow".
        let rawLayout = keyboards.Layouts.buildDefaultLayout(null, null, device.formFactor);
        layout = this.layout = keyboards.ActiveLayout.polyfill(rawLayout, null, device.formFactor as utils.FormFactor);
        this.isRTL = false;
      }
      this.layers=layout['layer'];

      // Override font if specified by keyboard
      if('font' in layout) {
        this.fontFamily=layout['font'];
      } else {
        this.fontFamily='';
      }

      let divLayerContainer = this.deviceDependentLayout(keyboard, device.formFactor as utils.FormFactor);

      this.ddOSK = true;

      // Append the OSK layer group container element to the containing element
      //osk.keyMap = divLayerContainer;
      Lkbd.appendChild(divLayerContainer);

      // Set base class - OS and keyboard added for Build 360
      this.kbdHelpDiv = this.kbdDiv = Lkbd;

      if(this.isStatic) {
        // The 'documentation' format uses the base element's child as the actual display base.
        (Lkbd.childNodes[0] as HTMLDivElement).className = device.formFactor + '-static kmw-osk-inner-frame';
      } else {
        Lkbd.className = device.formFactor + ' kmw-osk-inner-frame';
      }
    }

    get width(): number {
      if(this._width) {
        return this._width;
      } else {
        this.loadSizeFromCookie();
        return this.width;
      }
    }

    get height(): number {
      if(this._height) {
        return this._height;
      } else {
        this.loadSizeFromCookie();
        return this.height;
      }
    }

    protected loadSizeFromCookie() {
      let keyman = com.keyman.singleton;
      let util = keyman.util;

      // If no prior cookie exists, it merely returns an empty object / cookie.
      var c = util.loadCookie('KeymanWeb_OnScreenKeyboard');
      var newWidth: number, newHeight: number;

      // Restore OSK size - font size now fixed in relation to OSK height, unless overridden (in em) by keyboard
      newWidth=util.toNumber(c['width'], 0.333 * screen.width); // Default - 1/3rd of screen's width.

      if(newWidth < 0.2*screen.width) {
        newWidth = 0.2*screen.width;
      } else if(newWidth > 0.9*screen.width) {
        newWidth=0.9*screen.width;
      }
  
      // Default height decision made here: 
      // https://github.com/keymanapp/keyman/pull/4279#discussion_r560453929
      newHeight=util.toNumber(c['height'], 0.333 * newWidth);

      if(newHeight < 0.15*screen.height) {
        newHeight = 0.15 * screen.height;
      } else if(newHeight > 0.5*screen.height) {
        newHeight=0.5*screen.height;
      }

      this.setSize(newWidth, newHeight);
    }

    /**
     * Sets & tracks the size of the VisualKeyboard's primary element.
     * @param width 
     * @param height 
     * @param pending Set to `true` if called during a resizing interaction
     */
    public setSize(width: number, height: number, pending?: boolean) {
      this._width = width;
      this._height = height;

      if(!pending && this.kbdDiv) {
        this.kbdDiv.style.width=this._width+'px';
        this.kbdDiv.style.height=this._height+'px';
        this.kbdDiv.style.fontSize=(this._height/8)+'px';
      }
    }

    public defaultFontSize(): number {
      return this.height / 8;
    }

    /**
     * Called by OSKManager after resize operations in order to determine the final
     * size actually used by the visual keyboard.
     */
    public refit() {
      this._width=this.kbdDiv.offsetWidth;
      this._height=this.kbdDiv.offsetHeight;
    }

    /**
     * Returns the default properties for a key object, used to construct
     * both a base keyboard key and popup keys
     *
     * @return    {Object}    An object that contains default key properties
     */
    getDefaultKeyObject(): OSKKeySpec {
      return new OSKKeySpec(undefined, '', keyboards.ActiveKey.DEFAULT_KEY.width, keyboards.ActiveKey.DEFAULT_KEY.sp as keyboards.ButtonClass,
          null, keyboards.ActiveKey.DEFAULT_KEY.pad);
    };

    /**
     * Create the OSK for a particular keyboard and device
     *
     * @param       {Object}              layout      OSK layout definition
     * @param       {string}              formFactor  layout form factor
     * @return      {Object}                          fully formatted OSK object
     */
    deviceDependentLayout(keyboard: keyboards.Keyboard, formFactor: utils.FormFactor): HTMLDivElement {
      if(!keyboard) {
        // May occasionally be null in embedded contexts; have seen this when iOS engine sets
        // keyboard height during change of keyboards.
        keyboard = new keyboards.Keyboard(null);
      }
      let layout = keyboard.layout(formFactor);
      let util = com.keyman.singleton.util;
      let oskManager = com.keyman.singleton.osk;
      let rowsPercent = 100;

      var lDiv=util._CreateElement('div'), ls=lDiv.style, totalHeight=0;

      // Set OSK box default style
      lDiv.className='kmw-key-layer-group';

      // Adjust OSK height for mobile and tablet devices TODO move outside this function???
      switch(formFactor) {
        case 'phone':
        case 'tablet':
          totalHeight=oskManager.getHeight();
          ls.height=totalHeight+'px';
          rowsPercent = Math.round(100*oskManager.getKeyboardHeight()/totalHeight );
          break;
      }

      // Return empty DIV if no layout defined
      if(layout == null) {
        return lDiv;
      }

      // Set default OSK font size (Build 344, KMEW-90)
      let layoutFS = layout['fontsize'];
      if(typeof layoutFS == 'undefined' || layoutFS == null || layoutFS == '') {
        ls.fontSize='1em';
      } else {
        ls.fontSize=layout['fontsize'];
      }

      this.fontSize=ls.fontSize;       //TODO: move outside function*********

      // Create a separate OSK div for each OSK layer, only one of which will ever be visible
      var n: number, i: number, j: number;
      var layers: keyboards.LayoutLayer[], gDiv: HTMLDivElement;
      var rowHeight: number, rDiv: HTMLDivElement;
      var keys: keyboards.LayoutKey[], key: keyboards.LayoutKey, rs: CSSStyleDeclaration, gs: CSSStyleDeclaration;

      layers=layout['layer'];

      // Set key default attributes (must use exportable names!)
      var tKey=this.getDefaultKeyObject();
      tKey['fontsize']=ls.fontSize;

      // Identify key labels (e.g. *Shift*) that require the special OSK font
      var specialLabel=/\*\w+\*/;

      // ***Delete any empty rows at the end added by compiler bug...
      for(n=0; n<layers.length; n++) {
        let layer=layers[n];
        let rows=layer['row'];
        for(i=rows.length; i>0; i--) {
          if(rows[i-1]['key'].length > 0) {
            break;
          }
        }

        if(i < rows.length) {
          rows.splice(i-rows.length,rows.length-i);
        }
      }
      // ...remove to here when compiler bug fixed ***

      // Set the OSK row height, **assuming all layers have the same number of rows**

      // Calculate default row height
      rowHeight = rowsPercent/layers[0].row.length;

      // For desktop OSK, use a percentage of the OSK height
      if(formFactor == 'desktop') {
        rowHeight = rowsPercent/layers[0].row.length;
      }

      // Get the actual available document width and scale factor according to device type
      var objectWidth : number;
      if(formFactor == 'desktop' || this.isStatic) {
        objectWidth = 100;
      } else {
        objectWidth = oskManager.getWidth();
      }

      if(!this.isStatic && this.device.touchable) { //  /*&& ('ontouchstart' in window)*/ // Except Chrome emulation doesn't set this.
                                                                        // Not to mention, it's rather redundant.
        lDiv.addEventListener('touchstart', this.touch, true);
        // The listener below fails to capture when performing automated testing checks in Chrome emulation unless 'true'.
        lDiv.addEventListener('touchend', this.release,true);
        lDiv.addEventListener('touchmove', this.moveOver,false);
        //lDiv.addEventListener('touchcancel', osk.cancel,false); //event never generated by iOS
      }

      let precalibrated = (keyboard.getLayoutState(formFactor) == keyboards.LayoutState.CALIBRATED);

      for(n=0; n<layers.length; n++) {
        let layer=layers[n] as keyboards.ActiveLayer;
        gDiv=util._CreateElement('div'), gs=gDiv.style;
        gDiv.className='kmw-key-layer';

        // Always make the first layer visible
        gs.display=(n==0?'block':'none');
        gs.height=ls.height;

        // Set font for layer if defined in layout
        if('font' in layout) gs.fontFamily=layout['font']; else gs.fontFamily='';

        gDiv['layer']=gDiv['nextLayer']=layer['id'];
        if(typeof layer['nextlayer'] == 'string') gDiv['nextLayer']=layer['nextlayer'];

        // Create a DIV for each row of the group
        let rows=layer['row'];

        for(i=0; i<rows.length; i++) {
          rDiv=util._CreateElement('div');
          rDiv.className='kmw-key-row';
          // The following event trap is needed to prevent loss of focus in IE9 when clicking on a key gap.
          // Unclear why normal _CreateElement prevention of loss of focus does not seem to work here.
          // Appending handler to event handler chain does not work (other event handling remains active).
          rDiv.onmousedown=util.mouseDownPreventDefaultHandler; // Build 360
          //util.attachDOMEvent(rDiv,'mousedown',function(e){if(e)e.preventDefault();

          let row=rows[i];
          rs=rDiv.style;

          // Set row height. (Phone and tablet heights are later recalculated
          // and set in px, allowing for viewport scaling.)
          rs.maxHeight=rs.height=rowHeight+'%';

          // Apply defaults, setting the width and other undefined properties for each key
          keys=row['key'];

          if(!precalibrated || this.isStatic) {
            // Calculate actual key widths by multiplying by the OSK's width and rounding appropriately,
            // adjusting the width of the last key to make the total exactly 100%.
            // Overwrite the previously-computed percent.
            // NB: the 'percent' suffix is historical, units are percent on desktop devices, but pixels on touch devices
            // All key widths and paddings are rounded for uniformity
            var keyPercent: number, padPercent: number, totalPercent=0;
            for(j=0; j<keys.length-1; j++) {
              keyPercent = keys[j]['widthpc'] * objectWidth;
              keys[j]['widthpc']=keyPercent;
              padPercent = keys[j]['padpc'] * objectWidth;
              keys[j]['padpc']=padPercent;

              // Recompute center's x-coord with exact, in-browser values.
              (<keyboards.ActiveKey> keys[j]).proportionalX = (totalPercent + padPercent + (keyPercent/2))/objectWidth;
              (<keyboards.ActiveKey> keys[j]).proportionalWidth = keyPercent / objectWidth;

              totalPercent += padPercent+keyPercent;
            }

            // Allow for right OSK margin (15 layout units)
            let rightMargin = keyboards.ActiveKey.DEFAULT_RIGHT_MARGIN*objectWidth/layer.totalWidth;
            totalPercent += rightMargin;

            // If a single key, and padding is negative, add padding to right align the key
            if(keys.length == 1 && parseInt(keys[0]['pad'],10) < 0) {
              keyPercent = keys[0]['widthpc'] * objectWidth;
              keys[0]['widthpc']=keyPercent;
              totalPercent += keyPercent;
              keys[0]['padpc']=(objectWidth-totalPercent);

              // Recompute center's x-coord with exact, in-browser values.
              (<keyboards.ActiveKey> keys[0]).proportionalX = (totalPercent - rightMargin - keyPercent/2)/objectWidth;
              (<keyboards.ActiveKey> keys[0]).proportionalWidth = keyPercent / objectWidth;
            } else if(keys.length > 0) {
              j=keys.length-1;
              padPercent = keys[j]['padpc'] * objectWidth;
              keys[j]['padpc']=padPercent;
              totalPercent += padPercent;
              keys[j]['widthpc']= keyPercent = (objectWidth-totalPercent);

              // Recompute center's x-coord with exact, in-browser values.
              (<keyboards.ActiveKey> keys[j]).proportionalX = (objectWidth - rightMargin - keyPercent/2)/objectWidth;
              (<keyboards.ActiveKey> keys[j]).proportionalWidth = keyPercent / objectWidth;
            }
          }

          //Create the key square (an outer DIV) for each key element with padding, and an inner DIV for the button (btn)
          totalPercent=0;
          for(j=0; j<keys.length; j++) {
            key=keys[j];

            var keyGenerator = new OSKBaseKey(key as OSKKeySpec, layer['id'], formFactor);
            var keyTuple = keyGenerator.construct(this, layout, rs, totalPercent);

            rDiv.appendChild(keyTuple.element);
            totalPercent += keyTuple.percent;
          }
          // Add row to layer
          gDiv.appendChild(rDiv);
        }
        // Add layer to group
        lDiv.appendChild(gDiv);
      }

      // Now that we've properly processed the keyboard's layout, mark it as calibrated.
      keyboard.markLayoutCalibrated(formFactor);
      return lDiv;
    }
    //#endregion

    layerChangeHandler: text.SystemStoreMutationHandler = function(this: VisualKeyboard,
                                                                   source: text.MutableSystemStore,
                                                                   newValue: string) {
      if(source.value != newValue) {
        this.layerId = newValue;
        let keyman = com.keyman.singleton;
        keyman.osk._Show();
      }
    }.bind(this);

    //#region OSK touch handlers
    getTouchCoordinatesOnKeyboard(touch: Touch) {
      let keyman = com.keyman.singleton;

      // We need to compute the 'local', keyboard-based coordinates for the touch.
      let kbdCoords = keyman.util.getAbsolute(this.kbdDiv.firstChild as HTMLElement);
      let offsetCoords = {x: touch.pageX - kbdCoords.x, y: touch.pageY - kbdCoords.y};

      let layerGroup = this.kbdDiv.firstChild as HTMLDivElement;  // Always has proper dimensions, unlike kbdDiv itself.
      offsetCoords.x /= layerGroup.offsetWidth;
      offsetCoords.y /= layerGroup.offsetHeight;

      return offsetCoords;
    }

    getTouchProbabilities(touch: Touch): text.KeyDistribution {
      let keyman = com.keyman.singleton;
      if(!keyman.core.languageProcessor.mayCorrect) {
        return null;
      }

      // Note:  if subkeys are active, they will still be displayed at this time.
      // TODO:  In such cases, we should build an ActiveLayout (of sorts) for subkey displays,
      //        update their geometries to the actual display values, and use the results here.
      let touchKbdPos = this.getTouchCoordinatesOnKeyboard(touch);
      let layerGroup = this.kbdDiv.firstChild as HTMLDivElement;  // Always has proper dimensions, unlike kbdDiv itself.
      let width = layerGroup.offsetWidth, height = layerGroup.offsetHeight;
      // Prevent NaN breakages.
      if(!width || !height) {
        return null;
      }
      let baseKeyProbabilities = this.layout.getLayer(this.layerId).getTouchProbabilities(touchKbdPos, layerGroup.offsetWidth / layerGroup.offsetHeight);

      if(!this.popupBaseKey || !this.popupBaseKey.key) {
        return baseKeyProbabilities;
      } else {
        // A temp-hack, as this was noted just before 14.0's release.
        // Since a more... comprehensive solution would be way too complex this late in the game,
        // this provides a half-decent stopgap measure.
        //
        // Will not correct to nearby subkeys; only includes the selected subkey and its base keys.
        // Still, better than ignoring them both for whatever base key is beneath the final cursor location.
        let baseMass = 1.0;

        let baseKeyMass = 1.0;
        let baseKeyID = this.popupBaseKey.key.spec.coreID;

        let popupKeyMass = 0.0;
        let popupKeyID: string = null;

        // Note:  when embedded on Android (as of 14.0, at least), we don't get access to this.
        // Just the base key.
        if(this.keyPending && this.keyPending.key) {
          popupKeyMass = 3.0;
          popupKeyID = this.keyPending.key.spec.coreID;
        }

        // If the base key appears in the subkey array and was selected, merge the probability masses.
        if(popupKeyID == baseKeyID) {
          baseKeyMass += popupKeyMass;
          popupKeyMass = 0;
        }

        // Compute the normalization factor
        let totalMass = baseMass + baseKeyMass + popupKeyMass;
        let scalar = 1.0 / totalMass;

        // Prevent duplicate entries in the final map & normalize the remaining entries!
        for(let i=0; i < baseKeyProbabilities.length; i++) {
          let entry = baseKeyProbabilities[i];
          if(entry.keyId == baseKeyID) {
            baseKeyMass += entry.p * scalar;
            baseKeyProbabilities.splice(i, 1);
            i--;
          } else if(entry.keyId == popupKeyID) {
            popupKeyMass =+ entry.p * scalar;
            baseKeyProbabilities.splice(i, 1);
            i--;
          } else {
            entry.p *= scalar;
          }
        }

        let finalArray: {keyId: string, p: number}[] = [];

        if(popupKeyMass > 0) {
          finalArray.push({keyId: popupKeyID, p: popupKeyMass * scalar});
        }

        finalArray.push({keyId: baseKeyID, p: baseKeyMass * scalar});

        finalArray = finalArray.concat(baseKeyProbabilities);
        return finalArray;
      }
    }

    /**
     * The main OSK touch start event handler
     *
     *  @param  {Event} e   touch start event object
     *
     */
    touch: (e: TouchEvent) => void = function(this: VisualKeyboard, e: TouchEvent) {
      // Identify the key touched
      var t = <HTMLElement> e.changedTouches[0].target, key = this.keyTarget(t);

      // Save the touch point
      this.touchX = e.changedTouches[0].pageX;

      // Set the key for the new touch point to be current target, if defined
      this.currentTarget = key;

      // Clear repeated backspace if active, preventing 'sticky' behavior.
      this.cancelDelete();

      // Prevent multi-touch if popup displayed
      var sk = document.getElementById('kmw-popup-keys');
      if((sk && sk.style.visibility == 'visible') || this.popupVisible) {
        return;
      }

      // Keep track of number of active (unreleased) touch points
      this.touchCount = e.touches.length;

      // Get nearest key if touching a hidden key or the end of a key row
      if((key && ((key.className.indexOf('key-hidden') >= 0) || (key.className.indexOf('key-blank') >= 0)))
        || t.className.indexOf('kmw-key-row') >= 0) {
        key = this.findNearestKey(e,t);
      }
      // Do not do anything if no key identified!
      if(key == null) {
        return;
      }

      // Get key name (K_...) from element ID
      let keyName = key['keyId'];

      // Highlight the touched key
      this.highlightKey(key,true);

      // Special function keys need immediate action
      if(keyName == 'K_LOPT' || keyName == 'K_ROPT')      {
        window.setTimeout(function(this: VisualKeyboard){
          PreProcessor.clickKey(key);
          // Because we immediately process the key, we need to re-highlight it after the click.
          this.highlightKey(key, true);
          // Highlighting'll be cleared automatically later.
        }.bind(this),0);
        this.keyPending = null;
        this.touchPending = null;

        // Also backspace, to allow delete to repeat while key held
      } else if(keyName == 'K_BKSP') {
        let touchProbabilities = this.getTouchProbabilities(e.changedTouches[0]);
        // While we could inline the execution of the delete key here, we lose the ability to
        // record the backspace key if we do so.
        PreProcessor.clickKey(key, e.changedTouches[0], this.layerId, touchProbabilities);
        this.deleteKey = key;
        this.deleting = window.setTimeout(this.repeatDelete,500);
        this.keyPending = null;
        this.touchPending = null;
      } else {
        if(this.keyPending) {
          this.highlightKey(this.keyPending, false);
          let touchProbabilities = this.getTouchProbabilities(this.touchPending);
          PreProcessor.clickKey(this.keyPending, this.touchPending, this.layerId, touchProbabilities);
          this.clearPopup();
          // Decrement the number of unreleased touch points to prevent
          // sending the keystroke again when the key is actually released
          this.touchCount--;
        } else {
          // If this key has subkey, start timer to display subkeys after delay, set up release
          this.touchHold(key);
        }
        this.keyPending = key;
        this.touchPending = e.changedTouches[0];
      }
    }.bind(this);

    /**
     * OSK touch release event handler
     *
     *  @param  {Event} e   touch release event object
     *
     **/
    release: (e: TouchEvent) => void = function(this: VisualKeyboard, e: TouchEvent) {
      // Prevent incorrect multi-touch behaviour if native or device popup visible
      var sk = document.getElementById('kmw-popup-keys'), t = this.currentTarget;

      // Clear repeated backspace if active, preventing 'sticky' behavior.
      this.cancelDelete();

      if((sk && sk.style.visibility == 'visible')) {
        // Ignore release if a multiple touch
        if(e.touches.length > 0) {
          return;
        }

        // Cancel (but do not execute) pending key if neither a popup key or the base key
        if((t == null) || ((t.id.indexOf('popup') < 0) && (t.id != this.popupBaseKey.id))) {
          this.highlightKey(this.keyPending,false);
          this.clearPopup();
          this.keyPending = null;
          this.touchPending = null;
        }
      }

      // Only set when embedded in our Android/iOS app.  Signals that the device is handling
      // subkeys, so we shouldn't allow output for the base key.
      //
      // Note that on iOS (at least), this.release() will trigger before kmwembedded.ts's
      // executePopupKey() function.
      if(this.popupVisible) {
        return;
      }

      // Handle menu key release event
      if(t && t.id) {
        this.optionKey(t, t.id, false);
      }

      // Test if moved off screen (effective release point must be corrected for touch point horizontal speed)
      // This is not completely effective and needs some tweaking, especially on Android
      var x = e.changedTouches[0].pageX;
      var beyondEdge = ((x < 2 && this.touchX > 5) || (x > window.innerWidth - 2 && this.touchX < window.innerWidth - 5));

      // Save then decrement current touch count
      var tc=this.touchCount;
      if(this.touchCount > 0) {
        this.touchCount--;
      }

      // Process and clear highlighting of pending target
      if(this.keyPending) {
        this.highlightKey(this.keyPending,false);

        // Output character unless moved off key
        if(this.keyPending.className.indexOf('hidden') < 0 && tc > 0 && !beyondEdge) {
          let touchProbabilities = this.getTouchProbabilities(e.changedTouches[0]);
          PreProcessor.clickKey(this.keyPending, e.changedTouches[0], this.layerId, touchProbabilities);
        }
        this.clearPopup();
        this.keyPending = null;
        this.touchPending = null;
        // Always clear highlighting of current target on release (multi-touch)
      } else {
        var tt = e.changedTouches[0];
        t = this.keyTarget(tt.target);
        if(!t) {
          var t1 = document.elementFromPoint(tt.clientX,tt.clientY);
          t = this.findNearestKey(e, <HTMLElement> t1);
        }

        this.highlightKey(t,false);
      }
    }.bind(this);

    /**
     * OSK touch move event handler
     *
     *  @param  {Event} e   touch move event object
     *
     **/
    moveOver: (e: TouchEvent) => void = function(this: VisualKeyboard, e: TouchEvent) {
      let util = com.keyman.singleton.util;
      e.preventDefault();
      e.cancelBubble=true;

      if(typeof e.stopImmediatePropagation == 'function') {
        e.stopImmediatePropagation();
      } else if(typeof e.stopPropagation == 'function') {
        e.stopPropagation();
      }

      // Shouldn't be possible, but just in case.
      if(this.touchCount == 0) {
        this.cancelDelete();
        return;
      }

      // Get touch position
      var x=typeof e.touches == 'object' ? e.touches[0].clientX : e.clientX,
          y=typeof e.touches == 'object' ? e.touches[0].clientY : e.clientY;

      // Move target key and highlighting
      var t = this.touchPending = e.changedTouches[0],
          t1 = <HTMLElement> document.elementFromPoint(x,y),
          key0 = this.keyPending,
          key1 = this.keyTarget(t1); // Not only gets base keys, but also gets popup keys!

      // Find the nearest key to the touch point if not on a visible key
      if((key1 && key1.className.indexOf('key-hidden') >= 0) ||
        (t1 && (!key1) && t1.className.indexOf('key-row') >= 0)) {
          key1 = this.findNearestKey(e,t1);
      }

      // Stop repeat if no longer on BKSP key
      if(key1 && (typeof key1.id == 'string') && (key1.id.indexOf('-K_BKSP') < 0)) {
        this.cancelDelete();
      }

      // Do not attempt to support reselection of target key for overlapped keystrokes.
      // Perform _after_ ensuring possible sticky keys have been cancelled.
      if(e.touches.length > 1) {
        return;
      }

      // Do not move over keys if device popup visible
      if(this.popupVisible) {
        if(key1 == null) {
          if(key0) {
            this.highlightKey(key0,false);
          }
          this.keyPending=null;
          this.touchPending=null;
        } else {
          if(key1 == this.popupBaseKey) {
            if(!util.hasClass(key1,'kmw-key-touched')) {
              this.highlightKey(key1,true);
            }
            this.keyPending = key1;
            this.touchPending = e.touches[0];
          } else {
            if(key0) {
              this.highlightKey(key0,false);
            }
            this.keyPending = null;
            this.touchPending = null;
          }
        }
        return;
      }

      var sk=document.getElementById('kmw-popup-keys');

      // Use the popup duplicate of the base key if a phone with a visible popup array
      if(sk && sk.style.visibility == 'visible' && this.device.formFactor == 'phone' && key1 == this.popupBaseKey) {
        key1 = <KeyElement> sk.childNodes[0].firstChild;
      }

      // Identify current touch position (to manage off-key release)
      this.currentTarget = key1;

      // Clear previous key highlighting
      if(key0 && key1 && key1 !== key0) {
        this.highlightKey(key0,false);
      }

      // If popup is visible, need to move over popup, not over main keyboard
      this.highlightSubKeys(key1,x,y);

      if(sk && sk.style.visibility == 'visible') {
        // Once a subkey array is displayed, do not allow changing the base key.
        // Keep that array visible and accept no other options until the touch ends.
        if(key1 && key1.id.indexOf('popup') < 0 && key1 != this.popupBaseKey) {
          return;
        }

        // Highlight the base key on devices that do not append it to the subkey array.
        if(key1 && key1 == this.popupBaseKey && key1.className.indexOf('kmw-key-touched') < 0) {
          this.highlightKey(key1,true);
        }
        // Cancel touch if moved up and off keyboard, unless popup keys visible
      } else {
        // _Box has (most of) the useful client values.
        let keyman = com.keyman.singleton;
        let _Box = this.kbdDiv.parentElement ? this.kbdDiv.parentElement : keyman.osk._Box;
        let height = (this.kbdDiv.firstChild as HTMLElement).offsetHeight; // firstChild == layer-group, has height info.
        // We need to adjust the offset properties by any offsets related to the active banner.

        var yMin = (this.kbdDiv && _Box) ? Math.max(5, this.kbdDiv.offsetTop + _Box.offsetTop - 0.25*height) : 5;
        if(key0 && e.touches[0].pageY < yMin) {
          this.highlightKey(key0,false);
          this.showKeyTip(null,false);
          this.keyPending = null;
          this.touchPending = null;
        }
      }

      // Replace the target key, if any, by the new target key
      // Do not replace a null target, as that indicates the key has already been released
      if(key1 && this.keyPending) {
        this.keyPending = key1;
        this.touchPending = e.touches[0];
      }

      if(this.keyPending) {
        if(key0 != key1 || key1.className.indexOf('kmw-key-touched') < 0) {
          this.highlightKey(key1,true);
        }
      }

      if(key0 && key1 && (key1 != key0) && (key1.id != '')) {
        //  Display the touch-hold keys (after a pause)
        this.touchHold(key1);
        /*
        // Clear and restart the popup timer
        if(this.subkeyDelayTimer)
        {
          window.clearTimeout(this.subkeyDelayTimer);
          this.subkeyDelayTimer = null;
        }
        if(key1.subKeys != null)
        {
          this.subkeyDelayTimer = window.setTimeout(
            function()
            {
              this.clearPopup();
              this.showSubKeys(key1);
            }.bind(this),
            this.popupDelay);
        }
        */
      }
    }.bind(this);

    /**
     * Get the current key target from the touch point element within the key
     *
     * @param   {Object}  t   element at touch point
     * @return  {Object}      the key element (or null)
     **/
    keyTarget(target: HTMLElement | EventTarget): KeyElement {
      let keyman = com.keyman.singleton;
      let util = keyman.util;
      let t = <HTMLElement> target;

      try {
        if(t) {
          if(util.hasClass(t,'kmw-key')) {
            return getKeyFrom(t);
          }
          if(t.parentNode && util.hasClass(<HTMLElement> t.parentNode,'kmw-key')) {
            return getKeyFrom(t.parentNode);
          }
          if(t.firstChild && util.hasClass(<HTMLElement> t.firstChild,'kmw-key')) {
            return getKeyFrom(t.firstChild);
          }
        }
      } catch(ex) {}
      return null;
    }

    /**
     * Identify the key nearest to the touch point if at the end of a key row,
     * but return null more than about 0.6 key width from the nearest key.
     *
     *  @param  {Event}   e   touch event
     *  @param  {Object}  t   HTML object at touch point
     *  @return {Object}      nearest key to touch point
     *
     **/
    findNearestKey(e: TouchEvent, t: HTMLElement): KeyElement {
      if((!e) || (typeof e.changedTouches == 'undefined')
        || (e.changedTouches.length == 0)) {
        return null;
      }

      // Get touch point on screen
      var x = e.changedTouches[0].pageX;

      // Get key-row beneath touch point
      while(t && t.className !== undefined && t.className.indexOf('key-row') < 0) {
        t = <HTMLElement> t.parentNode;
      }
      if(!t) {
        return null;
      }

      // Find minimum distance from any key
      var k, k0=0, dx, dxMax=24, dxMin=100000, x1, x2;
      for(k = 0; k < t.childNodes.length; k++) {
        let keySquare = t.childNodes[k] as HTMLElement; // gets the .kmw-key-square containing a key
        // Find the actual key element.
        let childNode = keySquare.firstChild ? keySquare.firstChild as HTMLElement: keySquare;

        if(childNode.className !== undefined
            && (childNode.className.indexOf('key-hidden') >= 0
             || childNode.className.indexOf('key-blank') >= 0)) {
          continue;
        }
        x1 = keySquare.offsetLeft;
        x2 = x1 + keySquare.offsetWidth;
        if(x >= x1 && x <= x2) {
          // Within the key square
          return <KeyElement> childNode;
        }
        dx = x1 - x;
        if(dx >= 0 && dx < dxMin) {
          // To right of key
          k0 = k; dxMin = dx;
        }
        dx = x - x2;
        if(dx >= 0 && dx < dxMin) {
          // To left of key
          k0 = k; dxMin = dx;
        }
      }

      if(dxMin < 100000) {
        t = <HTMLElement> t.childNodes[k0];
        x1 = t.offsetLeft;
        x2 = x1 + t.offsetWidth;

        // Limit extended touch area to the larger of 0.6 of key width and 24 px
        if(t.offsetWidth > 40) {
          dxMax = 0.6 * t.offsetWidth;
        }

        if(((x1 - x) >= 0 && (x1 - x) < dxMax) || ((x - x2) >= 0 && (x - x2) < dxMax)) {
          return <KeyElement> t.firstChild;
        }
      }
      return null;
    }

    /**
     *  Repeat backspace as long as the backspace key is held down
     **/
    repeatDelete: () => void = function(this: VisualKeyboard) {
      if(this.deleting) {
        PreProcessor.clickKey(this.deleteKey);
        this.deleting = window.setTimeout(this.repeatDelete,100);
      }
    }.bind(this);

    /**
     * Cancels any active repeatDelete() timeouts, ensuring that
     * repeating backspace operations are properly terminated.
     */
    cancelDelete() {
      // Clears the delete-repeating timeout.
      if(this.deleting) {
        window.clearTimeout(this.deleting);
      }
      this.deleting = 0;
    }
    //#endregion

    // cancel = function(e) {} //cancel event is never generated by iOS

    /**
     * Function     findKeyElement
     * Scope        Private
     * @param       {string}   layerId
     * @param       {string}   keyId
     * Description  Finds the DOM element associated with the specified key, if it exists.
     */
    findKeyElement(layerId: string, keyId: string) {
      let layerGroup = this.kbdDiv.firstChild as HTMLDivElement;

      for(let i = 0; i < layerGroup.childElementCount; i++) {
        // TODO:  At some point, our OSK construction should 'link' a TS metadata type to this,
        // like with OSKKey / KeyElement for keys.
        let layer = layerGroup.childNodes[i] as HTMLDivElement;
        // row -> key-square -> actual KeyElement.
        let currentLayerId = (layer.firstChild.firstChild.firstChild as KeyElement).key.layer
        if(currentLayerId == layerId) {
          // Layer identified!  Now to find the key.  First - iterate over rows.
          for(let r = 0; r < layer.childElementCount; r++) {
            let row = layer.childNodes[r] as HTMLDivElement;
            for(let k = 0; k < row.childElementCount; k++) {
              let key = row.childNodes[k].firstChild as KeyElement;
              if(key.keyId == keyId) {
                return key;
              }
            }
          }
        }
      }

      return null;
    }

    /**
     * Function     _UpdateVKShiftStyle
     * Scope        Private
     * @param       {string=}   layerId
     * Description  Updates the OSK's visual style for any toggled state keys
     */
    _UpdateVKShiftStyle(layerId?: string) {
      var i, n, layer=null, layerElement=null;
      let core = com.keyman.singleton.core;

      if(layerId) {
        for(n=0; n<this.layers.length; n++) {
          if(this.layers[n]['id'] == this.layerId) {
            break;
          }
        }

        return;  // Failed to find the requested layer.
      } else {
        n=this.layerIndex;
        layerId=this.layers[n]['id'];
      }

      layer=this.layers[n];

      // Set the on/off state of any visible state keys.
      var states = ['K_CAPS',      'K_NUMLOCK',  'K_SCROLL'];
      var keys   = [layer.capsKey, layer.numKey, layer.scrollKey];

      for(i=0; i < keys.length; i++) {
        // Skip any keys not in the OSK!
        if(keys[i] == null) {
          continue;
        }

        keys[i]['sp'] = core.keyboardProcessor.stateKeys[states[i]] ? keyboards.Layouts.buttonClasses['SHIFT-ON'] : keyboards.Layouts.buttonClasses['SHIFT'];
        let keyId = layerId+'-'+states[i]
        var btn = document.getElementById(keyId);

        if(btn == null) {
          //This can happen when using BuildDocumentationKeyboard, as the OSK isn't yet in the
          //document hierarchy.  Sometimes.  (It's weird.)
          btn = this.findKeyElement(layerId, states[i]);
        }

        if(btn != null) {
          this.setButtonClass(keys[i], btn, this.layout);
        } else {
          console.warn("Could not find key to apply style: \"" + keyId + "\"");
        }
      }
    }

    /**
     * Attach appropriate class to each key button, according to the layout
     *
     * @param       {Object}    key     key object
     * @param       {Object}    btn     button object
     * @param       {Object=}   layout  source layout description (optional, sometimes)
     */
    setButtonClass(key, btn, layout?) {
      let keyman = com.keyman.singleton;
      var n=0, keyTypes=['default','shift','shift-on','special','special-on','','','','deadkey','blank','hidden'];
      if(typeof key['dk'] == 'string' && key['dk'] == '1') {
        n=8;
      }

      if(typeof key['sp'] == 'string') {
        n=parseInt(key['sp'],10);
      }

      if(n < 0 || n > 10) {
        n=0;
      }

      layout = layout || this.layout;

      // Apply an overriding class for 5-row layouts
      var nRows=layout['layer'][0]['row'].length;
      if(nRows > 4 && this.device.formFactor == 'phone') {
        btn.className='kmw-key kmw-5rows kmw-key-'+keyTypes[n];
      } else {
        btn.className='kmw-key kmw-key-'+keyTypes[n];
      }
    }

    clearPopup() {
      let oskManager = com.keyman.singleton.osk;
      // Remove the displayed subkey array, if any, and cancel popup request
      var sk=document.getElementById('kmw-popup-keys');
      if(sk != null) {
        if(sk.shim) {
          oskManager._Box.removeChild(sk.shim);
        }
        sk.parentNode.removeChild(sk);
      }

      if(this.popupCallout) {
        oskManager._Box.removeChild(this.popupCallout);
      }
      this.popupCallout = null;

      if(this.subkeyDelayTimer) {
          window.clearTimeout(this.subkeyDelayTimer);
          this.subkeyDelayTimer = null;
      }
      this.popupBaseKey = null;
    }

    //#region 'native'-mode subkey handling
    /**
     * Display touch-hold array of 'sub-keys' above the currently touched key
     * @param       {Object}    e      primary key element
     */
    showSubKeys(e: KeyElement) {
      // Do not show subkeys if key already released
      if(this.keyPending == null) {
        return;
      }

      let keyman = com.keyman.singleton;
      let util = keyman.util;
      let device = this.device;

      // A tag we directly set on a key element during its construction.
      let subKeySpec: OSKKeySpec[] = e['subKeys'];

      // Create holder DIV for subkey array, and set styles.
      // A subkey array for Shift will only appear if extra layers exist

      // The holder is position:fixed, but the keys do not need to be, as no scrolling
      // is possible while the array is visible.  So it is simplest to let the keys have
      // position:static and display:inline-block
      var subKeys=document.createElement('DIV'),i;

      var tKey = this.getDefaultKeyObject();

      subKeys.id='kmw-popup-keys';
      this.popupBaseKey = e;

      // #3718: No longer prepend base key to popup array

      // Must set position dynamically, not in CSS
      var ss=subKeys.style;
      ss.bottom=(parseInt(e.style.bottom,10)+parseInt(e.style.height,10)+4)+'px';

      // Set key font according to layout, or defaulting to OSK font
      // (copied, not inherited, since OSK is not a parent of popup keys)
      ss.fontFamily=this.fontFamily;

      // Copy the font size from the parent key, allowing for style inheritance
      ss.fontSize=keyman.util.getStyleValue(e,'font-size');
      ss.visibility='hidden';

      var nKeys=subKeySpec.length,nRow,nRows,nCols;
      nRows=Math.min(Math.ceil(nKeys/9),2);
      nCols=Math.ceil(nKeys/nRows);
      if(nRows > 1) {
        ss.width=(nCols*e.offsetWidth+nCols*5)+'px';
      }

      // Add nested button elements for each sub-key
      for(i=0; i<nKeys; i++) {
        var needsTopMargin = false;
        let nRow=Math.floor(i/nCols);
        if(nRows > 1 && nRow > 0) {
          needsTopMargin = true;
        }

        let keyGenerator = new com.keyman.osk.OSKSubKey(subKeySpec[i], e['key'].layer, device.formFactor);
        let kDiv = keyGenerator.construct(this, <KeyElement> e, needsTopMargin);

        subKeys.appendChild(kDiv);
      }

      // Clear key preview if any
      this.showKeyTip(null,false);

      // Otherwise append the touch-hold (subkey) array to the OSK
      keyman.osk._Box.appendChild(subKeys);

      // And correct its position with respect to that element
      ss=subKeys.style;
      var x=dom.Utils.getAbsoluteX(e)+0.5*(e.offsetWidth-subKeys.offsetWidth), y,
        xMax=(util.landscapeView()?screen.height:screen.width)-subKeys.offsetWidth;

      if(x > xMax) {
        x=xMax;
      }
      if(x < 0) {
        x=0;
      }
      ss.left=x+'px';

      // Make the popup keys visible
      ss.visibility='visible';

      // For now, should only be true (in production) when keyman.isEmbedded == true.
      let constrainPopup = keyman.isEmbedded;

      let cs = getComputedStyle(subKeys);
      let oskHeight = keyman.osk.getHeight();
      let bottomY = parseInt(cs.bottom, 10);
      let popupHeight = parseInt(cs.height, 10);

      let delta = 0;
      if(popupHeight + bottomY > oskHeight && constrainPopup) {
        delta = popupHeight + bottomY - oskHeight;
        ss.bottom = (bottomY - delta) + 'px';
      }

      // Add the callout
      this.popupCallout = this.addCallout(e, delta);

      // And add a filter to fade main keyboard
      subKeys.shim = document.createElement('DIV');
      subKeys.shim.id = 'kmw-popup-shim';
      keyman.osk._Box.appendChild(subKeys.shim);

      // Highlight the duplicated base key or ideal subkey (if a phone)
      if(device.formFactor == 'phone') {
        this.selectDefaultSubkey(e, subKeySpec, subKeys);
      }
    }

    selectDefaultSubkey(baseKey: KeyElement, subkeys: OSKKeySpec[], popupBase: HTMLElement) {
      var bk: KeyElement;
      for(let i=0; i < subkeys.length; i++) {
        let skSpec = subkeys[i];
        let skElement = <KeyElement> popupBase.childNodes[i].firstChild;

        // Preference order:
        // #1:  if a default subkey has been specified, select it.  (pending, for 15.0+)
        // #2:  if no default subkey is specified, default to a subkey with the same 
        //      key ID and layer / modifier spec.
        //if(skSpec.isDefault) { TODO for 15.0
        //  bk = skElement;
        //  break;
        //} else
        if(!baseKey.key || !baseKey.key.spec) {
          continue;
        }

        if(skSpec.elementID == baseKey.key.spec.elementID) {
          bk = skElement;
          break; // Best possible match has been found.  (Disable 'break' once above block is implemented.)
        }
      }

      if(bk) {
        this.keyPending = bk;
        this.highlightKey(bk,true);//bk.className = bk.className+' kmw-key-touched';
      }
    }


    //#endregion

    /**
     * Indicate the current language and keyboard on the space bar
     **/
    showLanguage() {
      let keyman = com.keyman.singleton;

      var lgName='',kbdName='';
      var activeStub = keyman.keyboardManager.activeStub;

      if(activeStub) {
        lgName=activeStub['KL'];
        kbdName=activeStub['KN'];
      } else if(keyman.getActiveLanguage(true)) {
        lgName=keyman.getActiveLanguage(true);
      } else {
        lgName='(System keyboard)';
      }

      try {
        var t=<HTMLElement> this.spaceBar.firstChild;
        let tParent = <HTMLElement> t.parentNode;
        if(typeof(tParent.className) == 'undefined' || tParent.className == '') {
          tParent.className='kmw-spacebar';
        } else if(tParent.className.indexOf('kmw-spacebar') == -1) {
          tParent.className +=' kmw-spacebar';
        }

        t.className='kmw-spacebar-caption';
        kbdName=kbdName.replace(/\s*keyboard\s*/i,'');

        // We use a separate variable here to keep down on MutationObserver messages in keymanweb.js code.
        var keyboardName = "";
        if(kbdName == lgName) {
          keyboardName=lgName;
        } else {
          keyboardName=lgName+' ('+kbdName+')';
        }
        // It sounds redundant, but this dramatically cuts down on browser DOM processing.
        if(t.innerHTML != keyboardName) {
          t.innerHTML = keyboardName;
        }
      }
      catch(ex){}
    }

    /**
     *  Add or remove a class from a keyboard key (when touched or clicked)
     *  or add a key preview for phone devices
     *
     *  @param    {Object}    key   key affected
     *  @param    {boolean}   on    add or remove highlighting
     **/
    highlightKey(key: KeyElement, on: boolean) {
      // Do not change element class unless a key
      if(!key || (key.className == '') || (key.className.indexOf('kmw-key-row') >= 0)) return;

      var classes=key.className, cs = ' kmw-key-touched';

      // For phones, use key preview rather than highlighting the key,
      var usePreview = ((this.keytip != null) && (key.id.indexOf('popup') < 0 ));

      if(usePreview) {
        // Previews are not permitted for keys using any of the following CSS styles.
        var excludedClasses = ['kmw-key-shift',      // special keys
                               'kmw-key-shift-on',   // active special keys (shift, when in shift layer
                               'kmw-key-special',    // special keys that require the keyboard's OSK font
                               'kmw-key-special-on', // active special keys requiring the keyboard's OSK font
                               'kmw-spacebar',       // space
                               'kmw-key-blank',      // Keys that are only used for layout control
                               'kmw-key-hidden'];

        for(let c=0; c < excludedClasses.length; c++) {
          usePreview = usePreview && (classes.indexOf(excludedClasses[c]) < 0);
        }
      }

      if(usePreview) {
        this.showKeyTip(key,on);
      } else {
        if(on && classes.indexOf(cs) < 0) {
          key.className=classes+cs;
          this.showKeyTip(null,false);     // Moved here by Serkan
        } else {
          key.className=classes.replace(cs,'');
        }
      }
    }

    //#region Mouse-event handling
    /**
     * Mouse down/mouse over event handler (desktop only)
     *
     * @param   {Event}  e  mouse over/mouse down event object
     */
    mouseOverMouseDownHandler = function(this: VisualKeyboard, e: MouseEvent) {
      let keyman = com.keyman.singleton;
      let util = keyman.util;

      var t = <HTMLElement> util.eventTarget(e);
      if(t === null || this.device.formFactor != 'desktop') {
        return;
      }

      if(t.nodeName == 'SPAN') {
        t = <HTMLElement> t.parentNode;
      }

      let key = this.keyTarget(t);

      if(util.eventType(e) == 'mousedown') {
        this.currentKey=key.id;
        util._CancelMouse(e);
        this.highlightKey(key, true);
      } else if(key.id == this.currentKey) {
        this.highlightKey(key, true);
      }
    }.bind(this);

    /**
     * Mouse up/mouse out event handler (desktop only)
     *
     * @param   {Event}  e  mouse up/out event object
     */
    mouseUpMouseOutHandler = function(this: VisualKeyboard, e: MouseEvent) {
      let keyman = com.keyman.singleton;
      let util = keyman.util;

      var t=<HTMLElement> util.eventTarget(e);
      if(t === null || this.device.formFactor != 'desktop') {
        return;
      }

      if(t.nodeName == 'SPAN') {
        t = <HTMLElement> t.parentNode;
      }

      let key = this.keyTarget(t);
      this.highlightKey(key, false);

      // Process as click if mouse button released anywhere over key
      if(util.eventType(e) == 'mouseup') {
        if(key.id == this.currentKey) {
          PreProcessor.clickKey(key);
        }
        this.currentKey='';
      }
    }.bind(this);
    //#endregion

    getKeyEmFontSize() {
      let keyman = com.keyman.singleton;
      let util = keyman.util;

      if(this.device.formFactor == 'desktop') {
        let kbdFontSize = this.defaultFontSize();
        let keySquareScale = 0.8; // Set in kmwosk.css, is relative.
        return kbdFontSize * keySquareScale;
      } else {
        let emSizeStr = getComputedStyle(document.body).fontSize;
        let emSize = util.getFontSizeStyle(emSizeStr).val;

        var emScale = 1;
        if(!this.isStatic) {
          // Reading this requires the OSK to be active, so we filter out
          // BuildVisualKeyboard calls here.
          let boxFontStyle = util.getFontSizeStyle(keyman.osk._Box);

          // Double-check against the font scaling applied to the _Box element.
          if(boxFontStyle.absolute) {
            return boxFontStyle.val;
          } else {
            emScale = boxFontStyle.val;
          }
        }
        return emSize * emScale;
      }
    }

        /**
     *  Set the reference to a special function key for the
     *  currently visible OSK layer
     *
     *  @param    {number}  nLayer  Index of visible layer
     *  @param    {string}  keyId   key identifier
     *  @return   {Object}          Reference to key
     */
    getSpecialKey(nLayer: number, keyId: string): KeyElement {
      let layers = this.kbdDiv.childNodes[0].childNodes;

      if(nLayer >= 0 && nLayer < layers.length) {
        // Special function keys will always be in bottom row (must modify code if not)
        let rows = layers[nLayer].childNodes;
        let keys = rows[rows.length-1].childNodes;
        for(var k=0; k<keys.length; k++) {
          let key = getKeyFrom(keys[k].firstChild);
          if(key && key['keyId'] == keyId) {
            return key;
          }
        }
      }
      return null;
    }

    show() {
      let device = this.device;
      var n,nLayer=-1, b = this.kbdDiv.childNodes[0].childNodes;

      for(n=0; n < b.length; n++) {
        let layerElement = <HTMLDivElement> b[n];
        if(layerElement['layer'] == this.layerId) {
          layerElement.style.display='block';
          //b[n].style.visibility='visible';
          this.nextLayer=this.layerId;
          this.layerIndex=nLayer=n;
          if(typeof this.layers[n]['nextlayer'] == 'string') {
            this.nextLayer=this.layers[n]['nextlayer'];
          }

          // If osk._Show has been called, there's probably been a change in modifier or state key state.  Keep it updated!
          this._UpdateVKShiftStyle();
        } else {
          layerElement.style.display='none';
          //layerElement.style.visibility='hidden';
        }
      }

      if(device.touchable) {
        // Identify and save references to the language key, hide keyboard key, and space bar
        this.lgKey=this.getSpecialKey(nLayer,'K_LOPT');     //TODO: should be saved with layer
        this.hkKey=this.getSpecialKey(nLayer,'K_ROPT');

        // Always adjust screen height if iPhone or iPod, to take account of viewport changes
        // Do NOT condition upon form-factor; this line prevents a bug with displaying
        // the predictive-text banner on the initial keyboard load.  (Issue #2907)
        if(device.OS == 'iOS') {
          this.adjustHeights();
        }
      }

      // Define for both desktop and touchable OSK
      this.spaceBar=this.getSpecialKey(nLayer,'K_SPACE'); //TODO: should be saved with layer
    }

    /**
     * Adjust the absolute height of each keyboard element after a rotation
     *
     **/
    adjustHeights() {
      let keyman = com.keyman.singleton;
      let _Box = keyman.osk._Box;
      let device = this.device;

      if(!_Box || !this.kbdDiv || !this.kbdDiv.firstChild || !this.kbdDiv.firstChild.firstChild.childNodes) {
        return false;
      }

      var fs=1.0;
      // TODO: Logically, this should be needed for Android, too - may need to be changed for the next version!
      if(device.OS == 'iOS' && !keyman.isEmbedded) {
        fs=fs/keyman.util.getViewportScale();
      }

      let oskHeight = this.computedAdjustedOskHeight();

      var b: HTMLElement = _Box, bs=b.style;
      bs.height=bs.maxHeight=oskHeight+'px';

      b = this.kbdDiv.firstChild as HTMLElement;
      bs=b.style;
      // Sets the layer group to the correct height.
      bs.height=bs.maxHeight=oskHeight+'px';
      bs.fontSize=fs+'em';

      this.adjustLayerHeights(oskHeight);

      return true;
    }

    private computedAdjustedOskHeight(): number {
      let oskManager = com.keyman.singleton.osk;
      let device = this.device;

      var layers=this.kbdDiv.firstChild.childNodes;
      let kbdHeight = oskManager.getKeyboardHeight();
      let oskHeight = 0;

      // In case the keyboard's layers have differing row counts, we check them all for the maximum needed oskHeight.
      for(let i = 0; i < layers.length; i++) {
        let nRows = layers[i].childNodes.length;
        let rowHeight = Math.floor(kbdHeight/(nRows == 0 ? 1 : nRows));
        let layerHeight = nRows * rowHeight;

        if(layerHeight > oskHeight) {
          oskHeight = layerHeight;
        }
      }

      // This isn't set anywhere else; it's a legacy part of the original methods.
      const oskPad = 0;
      let oskPaddedHeight = oskHeight + oskPad;

      if(device.OS == 'Android' && 'devicePixelRatio' in window) {
        oskPaddedHeight /= window.devicePixelRatio;
      }

      return oskPaddedHeight;
    }

    private adjustLayerHeights(oskHeight: number) {
      let oskManager = com.keyman.singleton.osk;
      let device = this.device;
      let layers = this.kbdDiv.firstChild.childNodes;

      for(let nLayer=0;nLayer<layers.length; nLayer++) {
        // Check the heights of each row, in case different layers have different row counts.
        let layer = layers[nLayer] as HTMLElement;
        let nRows=layers[nLayer].childNodes.length;
        (<HTMLElement> layers[nLayer]).style.height=(oskHeight)+'px';

        let rowHeight = Math.floor(oskManager.getKeyboardHeight()/(nRows == 0 ? 1 : nRows));

        if(device.OS == 'Android' && 'devicePixelRatio' in window) {
          layer.style.height = layer.style.maxHeight = oskHeight + 'px';
          rowHeight /= window.devicePixelRatio;
        }

        // Sets the layers to the correct height
        let rowPad = Math.round(0.15*rowHeight);

        for(let nRow=0; nRow<nRows; nRow++) {
          let rs=(<HTMLElement> layers[nLayer].childNodes[nRow]).style;
          let bottom = (nRows-nRow-1)*rowHeight+1;
          if(!this.isStatic) {
            rs.bottom=bottom+'px';
          }
          rs.maxHeight=rs.lineHeight=rs.height=rowHeight+'px';

          // Calculate the exact vertical coordinate of the row's center.
          this.layout.layer[nLayer].row[nRow].proportionalY = ((oskHeight - bottom) - rowHeight/2) / oskHeight;

          let keys=layers[nLayer].childNodes[nRow].childNodes as NodeListOf<HTMLElement>;
          this.adjustRowHeights(keys, rowHeight, bottom, rowPad);
        }
      }
    }

    private adjustRowHeights(keys: NodeListOf<HTMLElement>, rowHeight: number, bottom: number, pad: number) {
      let util = com.keyman.singleton.util;
      let device = this.device;

      let resizeLabels = (device.OS == 'iOS' && device.formFactor == 'phone' && util.landscapeView());

      let nKeys=keys.length;
      for(let nKey=0;nKey<nKeys;nKey++) {
        let keySquare=keys[nKey] as HTMLElement;
        //key.style.marginTop = (device.formFactor == 'phone' ? pad : 4)+'px';
        //**no longer needed if base key label and popup icon are within btn, not container**

        // Must set the height of the btn DIV, not the label (if any)
        var j;
        for(j=0; j<keySquare.childNodes.length; j++) {
          if(util.hasClass(keySquare.childNodes[j] as HTMLElement,'kmw-key')) {
            break;
          }
        }

        // Set the kmw-key-square position
        let ks=keySquare.style;
        if(!this.isStatic) {
          ks.bottom=(bottom-pad/2)+'px';
        }
        ks.height=ks.minHeight=(rowHeight)+'px';

        // Set the kmw-key position
        let keyElement = keySquare.childNodes[j] as KeyElement;
        ks=keyElement.style;
        if(!this.isStatic) {
          ks.bottom=bottom+'px';
        }
        ks.height=ks.lineHeight=ks.minHeight=(rowHeight-pad)+'px';

        // Get the kmw-key-text element & style.
        for(j=0; j<keyElement.childNodes.length; j++) {
          if(util.hasClass(keyElement.childNodes[j] as HTMLElement,'kmw-key-text')) {
            break;
          }
        }

        let keyTextSpan = keyElement.childNodes[j] as HTMLElement;
        if(keyElement.key && keyTextSpan) { // space bar may not define the text span!
          keyTextSpan.style.fontSize = keyElement.key.getIdealFontSize(this, ks);
        }

        // Rescale keycap labels on iPhone (iOS 7)
        if(resizeLabels && (j > 0)) {
          (keySquare.childNodes[0] as HTMLElement).style.fontSize='6px';
        }
      }
    }

    // /**
    //  * Function     _VKeyGetTarget
    //  * Scope        Private
    //  * @param       {Object}    e     OSK event
    //  * @return      {Object}          Target element for key in OSK
    //  * Description  Identify the OSK key clicked
    //  */
    // _VKeyGetTarget(e: Event) {
    //   var Ltarg;
    //   e = keymanweb._GetEventObject(e);   // I2404 - Manage IE events in IFRAMEs
    //   Ltarg = util.eventTarget(e);
    //   if (Ltarg == null) {
    //     return null;
    //   }
    //   if (Ltarg.nodeType == 3) { // defeat Safari bug
    //     Ltarg = Ltarg.parentNode;
    //   }
    //   if (Ltarg.tagName == 'SPAN') {
    //     Ltarg = Ltarg.parentNode;
    //   }
    //   return Ltarg;
    // }

    /**
     *  Append a style sheet for the current keyboard if needed for specifying an embedded font
     *  or to re-apply the default element font
     *
     **/
    appendStyleSheet() {
      let keymanweb = com.keyman.singleton;
      let util = keymanweb.util;

      var activeKeyboard = keymanweb.core.activeKeyboard;
      var activeStub: com.keyman.keyboards.KeyboardStub = keymanweb.keyboardManager.activeStub;

      // Do not do anything if a null stub
      if(activeStub == null) {
        return;
      }

      // First remove any existing keyboard style sheet
      if(this.styleSheet) {
        util.removeStyleSheet(this.styleSheet);
      }

      var i, kfd=activeStub['KFont'], ofd=activeStub['KOskFont'];

      // Add style sheets for embedded fonts if necessary (each font-face style will only be added once)
      util.addFontFaceStyleSheet(kfd);
      util.addFontFaceStyleSheet(ofd);

      // Temporarily hide duplicated elements on non-desktop browsers
      keymanweb.hideInputs();

      // Build the style string and append (or replace) the font style sheet
      // Note: Some browsers do not download the font-face font until it is applied,
      //       so must apply style before testing for font availability
      // Extended to allow keyboard-specific custom styles for Build 360
      var customStyle=this.addFontStyle(kfd,ofd);
      if( activeKeyboard != null && typeof(activeKeyboard.oskStyling) == 'string')  // KMEW-129
        customStyle=customStyle+activeKeyboard.oskStyling;

      this.styleSheet = util.addStyleSheet(customStyle); //Build 360

      // Wait until font is loaded then align duplicated input elements with page elements
      if(this.waitForFonts(kfd,ofd)) {
        keymanweb.alignInputs();
      }
    }

    /**
     *  Add or replace the style sheet used to set the font for input elements and OSK
     *
     *  @param  {Object}  kfd   KFont font descriptor
     *  @param  {Object}  ofd   OSK font descriptor (if any)
     *  @return {string}
     *
     **/
    addFontStyle(kfd, ofd): string {
      let keymanweb = com.keyman.singleton;

      // Get name of font to be applied
      var fn=keymanweb.baseFont;
      if(typeof(kfd) != 'undefined' && typeof(kfd['family']) != 'undefined') {
        fn=kfd['family'];
      }

      // Unquote font name in base font (if quoted)
      fn = fn.replace(/\u0022/g,'');

      // Set font family chain for mapped elements and remove any double quotes
      var rx=new RegExp('\\s?'+fn+',?'), ff=keymanweb.appliedFont.replace(/\u0022/g,'');

      // Remove base font name from chain if present
      ff = ff.replace(rx,'');
      ff = ff.replace(/,$/,'');

      // Then replace it at the head of the chain
      if(ff == '') {
        ff=fn;
      } else {
        ff=fn+','+ff;
      }

      // Re-insert quotes around individual font names
      ff = '"' + ff.replace(/\,\s?/g,'","') + '"';

      // Add to the stylesheet, quoted, and with !important to override any explicit style
      var s='.keymanweb-font{\nfont-family:' + ff + ' !important;\n}\n';

      // Set font family for OSK text
      if(typeof(ofd) != 'undefined') {
        s=s+'.kmw-key-text{\nfont-family:"'+ofd['family'].replace(/\u0022/g,'').replace(/,/g,'","')+'";\n}\n';
      } else if(typeof(kfd) != 'undefined') {
        s=s+'.kmw-key-text{\nfont-family:"'+kfd['family'].replace(/\u0022/g,'').replace(/,/g,'","')+'";\n}\n';
      }

      // Store the current font chain (with quote-delimited font names)
      keymanweb.appliedFont = ff;

      // Return the style string
      return s;
    }

    /**
     * Create copy of the OSK that can be used for embedding in documentation or help
     * The currently active keyboard will be returned if PInternalName is null
     *
     *  @param  {string}          PInternalName   internal name of keyboard, with or without Keyboard_ prefix
     *  @param  {number}          Pstatic         static keyboard flag  (unselectable elements)
     *  @param  {string=}         argFormFactor   layout form factor, defaulting to 'desktop'
     *  @param  {(string|number)=}  argLayerId    name or index of layer to show, defaulting to 'default'
     *  @return {Object}                          DIV object with filled keyboard layer content
     */
    static buildDocumentationKeyboard(PInternalName,Pstatic,argFormFactor,argLayerId): HTMLElement { // I777
      let keymanweb = com.keyman.singleton;
      var PKbd=keymanweb.core.activeKeyboard,Ln,
          formFactor=(typeof(argFormFactor) == 'undefined' ? 'desktop' : argFormFactor),
          layerId=(typeof(argLayerId) == 'undefined' ? 'default' : argLayerId),
          device = new Device();

      // Device emulation for target documentation.
      device.formFactor = formFactor;
      if(formFactor != 'desktop') {
        device.OS = 'iOS';
      }

      var keyboardsList = keymanweb.keyboardManager.keyboards;

      if(PInternalName != null) {
        var p=PInternalName.toLowerCase().replace('keyboard_','');

        for(Ln=0; Ln<keyboardsList.length; Ln++) {
          if(p == keyboardsList[Ln]['KI'].toLowerCase().replace('keyboard_','')) {
            // Requires the Keyboard wrapping object now.
            PKbd = new com.keyman.keyboards.Keyboard(keyboardsList[Ln]);
            break;
          }
        }
      }

      if(!PKbd) {
        return null;
      }

      let layout = PKbd.layout(formFactor);

      let kbdObj = new VisualKeyboard(PKbd, device, true);
      let kbd = kbdObj.kbdDiv.childNodes[0] as HTMLDivElement; // Gets the layer group.

      // Select the layer to display, and adjust sizes
      if(layout != null) {
        kbdObj.layerId = layerId;
        kbdObj.show();
        kbdObj.adjustHeights(); // Necessary for the row heights to be properly set!
        // Relocates the font size definition from the main VisualKeyboard wrapper, since we don't return the whole thing.
        kbd.style.fontSize = kbdObj.kbdDiv.style.fontSize;
      } else {
        kbd.innerHTML="<p style='color:#c40; font-size:0.5em;margin:10px;'>No "+formFactor+" layout is defined for "+PKbd.name+".</p>";
      }
      // Add a faint border
      kbd.style.border='1px solid #ccc';
      return kbd;
    }

    onHide() {
      // Remove highlighting from hide keyboard key, if applied
      if(this.hkKey) {
        this.highlightKey(this.hkKey,false);
      }
    }

    /**
   * Touch hold key display management
   *
   * @param   {Object}  key   base key object
   */
  touchHold(key: KeyElement) {
    // Clear and restart the popup timer
    if(this.subkeyDelayTimer) {
      window.clearTimeout(this.subkeyDelayTimer);
      this.subkeyDelayTimer = null;
    }

    if(typeof key['subKeys'] != 'undefined' && key['subKeys'] != null) {
      this.subkeyDelayTimer = window.setTimeout(
        function(this: VisualKeyboard) {
          this.clearPopup();
          this.showSubKeys(key);
        }.bind(this), this.popupDelay);
    }
  };

  optionKey(e: KeyElement, keyName: string, keyDown: boolean) {
    let keyman = com.keyman.singleton;
    let oskManager = keyman.osk;
    if(keyDown) {
      if(keyName.indexOf('K_LOPT') >= 0) {
        oskManager.showLanguageMenu();
      } else if(keyName.indexOf('K_ROPT') >= 0) {
        keyman.uiManager.setActivatingUI(false);
        oskManager._Hide(true);
        let active = keyman.domManager.getActiveElement();
        if(dom.Utils.instanceof(active, "TouchAliasElement")) {
          (active as dom.TouchAliasElement).hideCaret();
        }
        keyman.domManager.clearLastActiveElement();
      }
    }
  };

  // Manage popup key highlighting
  highlightSubKeys(k: KeyElement, x: number, y: number) {
    let util = com.keyman.singleton.util;

    // Test for subkey array, return if none
    // (JH 2/4/19) So, if a subkey is passed in, we return immediately?
    if(k == null || k['subKeys'] == null) {
      return;
    }

    // Highlight key at touch position (and clear other highlighting)
    var i,sk,x0,y0,x1,y1,onKey,skBox=document.getElementById('kmw-popup-keys');

    //#region This section fills a different role than the method name would suggest.
    // Might correspond better to a 'checkInstantSubkeys' or something.

    // Show popup keys immediately if touch moved up towards key array (KMEW-100, Build 353)
    if((this.touchY-y > 5) && skBox == null) {
      if(this.subkeyDelayTimer) {
        window.clearTimeout(this.subkeyDelayTimer);
      }
      this.showSubKeys(k);
      skBox=document.getElementById('kmw-popup-keys');
    }
    //#endregion

    /* (JH 2/4/19) Because of that earlier note, in KMW 12 alpha (and probably 11),
     * the following code is effectively impotent and could be deleted with no effect.
     * Note that this probably results from VisualKeyboard.keyTarget finding the
     * subkey first... which is necessary anyway to support subkey output.
     */
    for(i=0; i < k['subKeys'].length; i++) {
      try {
        sk=<HTMLElement> skBox.childNodes[i].firstChild;
        x0=dom.Utils.getAbsoluteX(sk); y0=dom.Utils.getAbsoluteY(sk);//-document.body.scrollTop;
        x1=x0+sk.offsetWidth; y1=y0+sk.offsetHeight;
        onKey=(x > x0 && x < x1 && y > y0 && y < y1);
        this.highlightKey(sk, onKey);
        if(onKey) {
          this.highlightKey(k, false);
        }
      } catch(ex){}
    }
  };

  /**
   * Add (or remove) the keytip preview (if KeymanWeb on a phone device)
   *
   * @param   {Object}  key   HTML key element
   * @param   {boolean} on    show or hide
   */
  showKeyTip(key: KeyElement, on: boolean) {
    let keyman = com.keyman.singleton;
    let util = keyman.util;
    let oskManager = keyman.osk;

    var tip=this.keytip;

    // Do not change the key preview unless key or state has changed
    if(tip == null || (key == tip.key && on == tip.state)) {
      return;
    }

    var sk=document.getElementById('kmw-popup-keys'),
        popup = (sk && sk.style.visibility == 'visible')

    // Create and display the preview
    if(on && !popup) {
      var y0 = dom.Utils.getAbsoluteY(oskManager._Box),
          h0 = oskManager._Box.offsetHeight,
          xLeft = dom.Utils.getAbsoluteX(key),
          xTop = dom.Utils.getAbsoluteY(key),
          xWidth = key.offsetWidth,
          xHeight = key.offsetHeight,
          kc = <HTMLElement> key.firstChild,
          kcs = kc.style,
          kts = tip.element.style,
          ktLabel = <HTMLElement> tip.element.childNodes[1],
          ktls = ktLabel.style,
          edge = 0,
          canvas = <HTMLCanvasElement> tip.element.firstChild,
          previewFontScale = 1.8;

      // Find key text element
      for(var i=0; i<key.childNodes.length; i++) {
        kc = <HTMLElement> key.childNodes[i];
        if(util.hasClass(kc,'kmw-key-text')) {
          break;
        }
      }

      // Canvas dimensions must be set explicitly to prevent clipping
      canvas.width = 1.6 * xWidth;
      canvas.height = 2.3 * xHeight;

      kts.top = 'auto';
      // Matches how the subkey positioning is set.
      kts.bottom = (parseInt(key.style.bottom, 10))+'px';
      kts.textAlign = 'center';   kts.overflow = 'visible';
      kts.fontFamily = util.getStyleValue(kc,'font-family');
      kts.width = canvas.width+'px';
      kts.height = canvas.height+'px';

      var px=util.getStyleInt(kc, 'font-size');
      if(px != 0) {
        let popupFS = previewFontScale * px;
        let scaleStyle = {
          fontFamily: kts.fontFamily,
          fontSize: popupFS + 'px',
          height: 1.6 * xHeight + 'px' // as opposed to the canvas height of 2.3 * xHeight.
        };

        kts.fontSize = key.key.getIdealFontSize(this, scaleStyle);
      }

      ktLabel.textContent = kc.textContent;
      ktls.display = 'block';
      ktls.position = 'absolute';
      ktls.textAlign = 'center';
      ktls.width='100%';
      ktls.top = '2%';
      ktls.bottom = 'auto';

      // Adjust canvas shape if at edges
      var xOverflow = (canvas.width - xWidth) / 2;
      if(xLeft < xOverflow) {
        edge = -1;
        xLeft += xOverflow;
      } else if(xLeft > window.innerWidth - xWidth - xOverflow) {
        edge = 1;
        xLeft -= xOverflow;
      }

      // For now, should only be true (in production) when keyman.isEmbedded == true.
      let constrainPopup = keyman.isEmbedded;

      let cs = getComputedStyle(tip.element);
      let oskHeight = keyman.osk.getHeight();
      let bottomY = parseInt(cs.bottom, 10);
      let tipHeight = parseInt(cs.height, 10);

      let delta = 0;
      if(tipHeight + bottomY > oskHeight && constrainPopup) {
        delta = tipHeight + bottomY - oskHeight;
        canvas.height = canvas.height - delta;
        kts.height = canvas.height + 'px';
      }

      this.drawPreview(canvas, xWidth, xHeight, edge, delta);

      kts.left=(xLeft - xOverflow) + 'px';
      kts.display = 'block';
    } else { // Hide the key preview
      tip.element.style.display = 'none';
    }

    // Save the key preview state
    tip.key = key;
    tip.state = on;
  };

  /**
   * Draw key preview in element using CANVAS
   *  @param  {Object}  canvas CANVAS element
   *  @param  {number}  w width of touched key, px
   *  @param  {number}  h height of touched key, px
   *  @param  {number}  edge  -1 left edge, 1 right edge, else 0
   */
  drawPreview(canvas: HTMLCanvasElement, w: number, h: number, edge: number, delta?: number) {
    let util = com.keyman.singleton.util;
    let device = util.device;

    delta = delta || 0;

    var ctx = canvas.getContext('2d'), dx = (canvas.width - w)/2, hMax = canvas.height + delta,
        w0 = 0, w1 = dx, w2 = w + dx, w3 = w + 2 * dx,
        h1 = 0.5 * hMax, h2 = 0.6 * hMax, h3 = hMax, r = 8;

    let hBoundedMax = canvas.height;

    h2 = h2 > hBoundedMax ? hBoundedMax : h2;
    h3 = hMax > hBoundedMax ? hBoundedMax : h3;

    if(device.OS == 'Android') {
      r = 3;
    }

    // Adjust the preview shape at the edge of the keyboard
    switch(edge) {
      case -1:
        w1 -= dx;
        w2 -= dx;
        break;
      case 1:
        w1 += dx;
        w2 += dx;
        break;
    }

    // Clear the canvas
    ctx.clearRect(0,0,canvas.width,canvas.height);

    // Define appearance of preview (cannot be done directly in CSS)
    if(device.OS == 'Android') {
      var wx=(w1+w2)/2;
      w1 = w2 = wx;
    }
    ctx.fillStyle = device.styles.popupCanvasBackgroundColor;
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#cccccc';

    // Draw outline
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(w0+r,0);
    ctx.arcTo(w3,0,w3,r,r);
    if(device.OS == 'Android') {
      ctx.arcTo(w3,h1,w2,h2,r);
      ctx.arcTo(w2,h2,w1,h2,r);
    } else {
      let lowerR = 0;
      if(h3 > h2) {
        lowerR = h3-h2 > r ? r : h3-h2;
      }
      ctx.arcTo(w3,h1,w2,h2,r);
      ctx.arcTo(w2,h2,w2-lowerR,h3,lowerR);
      ctx.arcTo(w2,h3,w1,h3,lowerR);
      ctx.arcTo(w1,h3,w1,h2-lowerR,lowerR);
    }
    ctx.arcTo(w1,h2,w0,h1-r,r);
    ctx.arcTo(w0,h1,w0,r,r);
    ctx.arcTo(w0,0,w0+r,0,r);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };

    /**
     *  Create a key preview element for phone devices
     */
    createKeyTip() {
      let keyman = com.keyman.singleton;
      let util = keyman.util;

      if(keyman.util.device.formFactor == 'phone') {
        if(this.keytip == null) {
          this.keytip = {
            key: null,
            state: false
          }
          let tipElement = this.keytip.element=util._CreateElement('div');
          tipElement.className='kmw-keytip';
          tipElement.id = 'kmw-keytip';

          // The following style is critical, so do not rely on external CSS
          tipElement.style.pointerEvents='none';

          // Add CANVAS element for outline and SPAN for key label
          tipElement.appendChild(util._CreateElement('canvas'));
          tipElement.appendChild(util._CreateElement('span'));
        }

        // Always append to _Box (since cleared during OSK Load)
        keyman.osk._Box.appendChild(this.keytip.element);
      }
    };

    /**
     * Add a callout for popup keys (if KeymanWeb on a phone device)
     *
     * @param   {Object}  key   HTML key element
     * @return  {Object}        callout object
     */
    addCallout(key: KeyElement, delta?: number): HTMLDivElement {
      let keyman = com.keyman.singleton;
      let util = keyman.util;

      if(util.device.formFactor != 'phone' || util.device.OS != 'iOS') {
        return null;
      }

      delta = delta || 0;

      let calloutHeight = key.offsetHeight - delta;

      if(calloutHeight > 0) {
        var cc = util._CreateElement('div'), ccs = cc.style;
        cc.id = 'kmw-popup-callout';
        keyman.osk._Box.appendChild(cc);

        // Create the callout
        var xLeft = key.offsetLeft,
            xTop = key.offsetTop + delta,
            xWidth = key.offsetWidth,
            xHeight = calloutHeight;

        // Set position and style
        ccs.top = (xTop-6)+'px'; ccs.left = xLeft+'px';
        ccs.width = xWidth+'px'; ccs.height = (xHeight+6)+'px';

        // Return callout element, to allow removal later
        return cc;
      } else {
        return null;
      }
    }

    /**
     * Wait until font is loaded before applying stylesheet - test each 100 ms
     * @param   {Object}  kfd   main font descriptor
     * @param   {Object}  ofd   secondary font descriptor (OSK only)
     * @return  {boolean}
     */
    waitForFonts(kfd, ofd) {
      let keymanweb = com.keyman.singleton;
      let util = keymanweb.util;

      let fontDefined = !!(kfd && kfd['files']);
      kfd = fontDefined ? kfd : undefined;

      let oskFontDefined = !!(ofd && ofd['files']);
      ofd = oskFontDefined ? ofd : undefined;

      // Automatically 'ready' if the descriptor is explicitly `undefined`.
      // Thus, also covers the case where both are undefined.
      var kReady=util.checkFontDescriptor(kfd), oReady=util.checkFontDescriptor(ofd);
      if(kReady && oReady) {
        return true;
      }

      keymanweb.fontCheckTimer=window.setInterval(function() {
        if(util.checkFontDescriptor(kfd) && util.checkFontDescriptor(ofd)) {
          window.clearInterval(keymanweb.fontCheckTimer);
          keymanweb.fontCheckTimer=null;
          keymanweb.alignInputs();
        }
      }, 100);

      // Align anyway as best as can if font appears to remain uninstalled after 5 seconds
      window.setTimeout(function() {
        if(keymanweb.fontCheckTimer)
        {
          window.clearInterval(keymanweb.fontCheckTimer);
          keymanweb.fontCheckTimer=null;
          keymanweb.alignInputs();
          // Don't notify - this is a management issue, not anything the user needs to deal with
          // TODO: Consider having an icon in the OSK with a bubble that indicates missing font
          //util.alert('Unable to download the font normally used with '+ks['KN']+'.');
        }
      }, 5000);
      return false;
    };

    shutdown() {
      let keyman = com.keyman.singleton;

      // Prevents style-sheet pollution from multiple keyboard swaps.
      if(this.styleSheet) {
        keyman.util.removeStyleSheet(this.styleSheet);
      }
    }
  }
}
