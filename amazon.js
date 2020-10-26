// ==UserScript==
// @name         Amazon Price by Volume
// @version      0.0.2
// @author       samy kamkar
// @description  Show prices on Amazon by volume, including quantity, for relative pricing
// @include      *://*.amazon.com/*s?*
// @require      https://ajax.googleapis.com/ajax/libs/jquery/1.9.1/jquery.min.js
// @Xrequire     file:///Users/samy/Code/amazon/amazonshelper/amazon.js
// @namespace    https://samy.pl
// ==/UserScript==

/*
TODO
- add sort by price
- add input to remove items by description, eg -polycarbonate (amazon doesn't support this in search)
- add the lengths/qtys/etc in adjustable inputs
- allow removing items by clicking n 'x'
  - might not be needed once sorting is added

*/ (function() {

// a '/' in the value means inches, eg 1/8
// XXX generate re_size from the `sizes` object starting with longest first
// break down our regexpes into reusable chunks
let re_size    = '(?:(?:\'|"|inches|inch|in|cm|mm|thou|mil|ft|feet|foot|thi[cn]k(?:ness)?)\\.?)' //
let re_num     = '(?:(?:\\d+\\s+)?\\d+(?:[/.]\\d+)?|\\.\\d+)' // 1 1/2 OR 4 OR 5.2 OR 3/4
let re_inch    = '(?:(?:\\d+\\s+)?\\d+/\\d+|\\d+\\.\\d{3})' // 3/4 OR 1 1/2
let pre_type   = `(?:${re_num}\\s*-?${re_size}|${re_inch})` // 3.4 inches
let pre_notype = `(?:${re_num}\\s*-?${re_size}?|${re_inch})` // 3.4
let num_type   = `(?:(${pre_type})(?:\\s*\\(${pre_type}\\))?)` // 1 in (2.54cm)
let num_notype = `(?:(${pre_notype})(?:\\s*\\(${pre_notype}\\))?)` // 1 (2.54)
let diam       = `(?:diameter|diam|dia)`
let len        = `(?:length|len|long)`
let by         = `\\s*(?:x|by)\\s*`
// width by height
let re_wh      = `${num_notype}${by}${num_notype}`
// quantity
let re_qty     = /(\d+)\s*-?\s*(?:qty|quantity|pack|piece|pcs?|sheets?)|pack\s+of\s+(\d+)/
// various width by height by depth options
let re_whd_arr = [ // ORs
  `${num_notype}\\s*thi[cn]k.*?${re_wh}`,
  `${re_wh}.*?${num_notype}\\s*thi[cn]k`,

  `${num_notype}${by}${re_wh}`,
  `${num_type}.*?${re_wh}`,

  `${re_wh}.*?${num_type}`,
]
// for rods, various length by diameter options
let re_diamlen_arr = [ // ORs
  `${num_notype}.*?${num_notype}\\s*long`,
  `${num_notype}\\s*${diam}?${by}(?:\\s*${len}\\s*)?${num_notype}`,
  `${diam}\\s*${num_notype}\\s*${len}\\s*${num_type}`
]

let re_whd     = re_whd_arr.join('|')
let re_diamlen = re_diamlen_arr.join('|')

let rg_size    = new RegExp(`(${re_size})`, 'i')
let rg_rmsize  = new RegExp(`\\s*-?${re_size}`, 'i')
let sizes = {
  '"': 'in',
  'in': 'in',
  'inch': 'in',
  'inches': 'in',

  "'": 'ft',
  'ft': 'ft',
  'feet': 'ft',
  'foot': 'ft',
  'foots': 'ft', // :)

  'mil': 'mil',
  'mils': 'mil',
  'thou': 'mil'
}

let defaultDesc = [
  {
    're': re_qty,
    'names': ['qty'],
  }
]

// calculations to do for different volumes
let calcs = [
  { // support sheets
    'searchRe': /sheet|panel/, // search box must match this text (regexp)
    'calc': 'price/(thick*width*height*qty)', // text gets replaced with values[text]
    'type': '^3',
    'descRe': [ // the calc variables are produced from these regexpes
      {
        // maybe remove 's' from pcs? may have false positives
        're': re_qty,
        'names': ['qty'],
      }, {
        're': new RegExp(re_whd),
        'names': ['width', 'height', 'thick']
      }
    ]
  },
  { // support rods
    'searchRe': /rod|bar/,
    'calc': 'price/(3.14*((diam/2)**2)*length*qty)', // text gets replaced with values[text]
    'type': '^3',
    'descRe': [
      {
        // maybe remove 's' from pcs? may have false positives
        're': re_qty,
        'names': ['qty'],
      }, {
        're': new RegExp(re_diamlen),
        'names': ['diam', 'length']
        // }, {
          // 're': new RegExp(`${num_type}\s+long`),
          //'names': ['height']
      }
    ]
  }
]

// on page load
$(document).ready(onPageLoad)

//////////////////////////////////////////////////////////////////////////////
// functions
//
//

// hide elements we don't like
function hideElems()
{
  //$('.a-color-secondary').hide() // hide per-item pricing
  $('.a-text-price').hide() // hide striked out prices
  $('span span span:contains("Out of Stock")').closest('div.sg-col-inner').parent().hide() // hide out of stock items
}

// page load!
function onPageLoad()
{
  console.log('amazon volume pricing started')

  // hide stuff we don't want
  hideElems()

  // grab search box text
  let search = $('input[name="field-keywords"]').val().toLowerCase()

  // scan through items with the calculation we want done based on the search text
  scanItems(calcs.find(o => search.match(o.searchRe)))
}

// scan through items and calculate price by volume
function scanItems(obj)
{
  // go through each amazon item
  $('.s-result-item').each(function(ind)
  {
    let values = {}

    // set price and desc
    values.price = $(this).find('span.a-offscreen').first().text().replace('$', '')
    values.desc = cleanup($(this).find('span.a-text-normal').first().text())

    // go through regexpes to pull data out of description
    values = parseText(values, values.desc, obj ? obj.descRe : defaultDesc)
    values.qty = values.qty || 1
    values.unitprice = round(values.price / values.qty)

    // if we don't have a secondary price and we do have qty pricing
    if (!$(this).find('.a-price').next().length)
      $(this).find('.a-price').after(`<span class="a-size-base a-color-secondary" dir="auto">($${values.unitprice}/ea)</span>`)

    if (!obj) return

    // find length types
    for (let key of Object.keys(values))
    {
      let match = rg_size.exec(values[key])
      if (match)
      {
          // remove type from string (3 in -> 3)
          values[key] = values[key].replace(rg_rmsize, '')
          console.log("length type", key,`\\s*${re_size}`, values[key], match, sizes[match[1]])

          let type = match[1].toLowerCase()
          if (!values[`type`])
            values[`type`] = sizes[type] || type
          values[`${key}_type`] = sizes[type] || type || values['type']
      }

      // consider 1/2 as inches
      else if (values[key].length && (values[key].substr('/') >= 0 || values[key].indexOf('"') > -1))
        values[`${key}_type`] = sizes['inch']
    }

    // XXX
    // fill in other types
    if (!values['width_type'])
      values['width_type'] = values['height_type'] || values['thick_type']
    if (!values['height_type'])
      values['height_type'] = values['width_type'] || values['thick_type']
    if (!values['thick_type'])
      values['thick_type'] = values['width_type'] || values['height_type']

    // general type
    if (!values['type'])
      values['type'] = values['width_type']

    let calc = runCalc(values, obj)
    if (!isNaN(calc) && Number.isFinite(calc))
    {
      values.calc = calc
      calc = round(calc)
      $(this).find('.a-price-fraction').append(` <font color=red>\$${calc}/${values.type}${obj.type}</font>`)
    }

    console.log(values)
  })

} // end of items()

// round 1.2345 to 1.235
function round(num, points)
{
  return num.toFixed(points || 3)
}

// convert smart quotes/unicode to normal quotes
function cleanup(str)
{
  return str.toLowerCase().replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'").replace(/''/g, '"')
}

// convert units as some descriptions mix metric and imperial
function convert(val, from, to)
{
  console.log(`convert val=${val} from=${from} to=${to}`)
  if (sizes[from] === sizes.mm && sizes[to] === sizes.inch)
    val /= 25.4
  else if (sizes[from] === sizes.mm && sizes[to] === sizes.foot)
    val /= 304.8
  else
    val = -1
  return val
}

// calculate data from object
function runCalc(values, obj)
{
  console.log('runcalc', values)

  // ensure values are same type
  for (const [k, v] of Object.entries(values))
  {
    console.log('kv', k, v)
    if (values[`${k}_type`] && values[`${k}_type`] !== values['type'])
    {
      values[k] = convert(v, values[`${k}_type`], values['type'])
      values[`${k}_type`] = values['type']
    }
  }
  let calcstr = obj.calc.replace(/([a-z]+)/g, key => values[key] || 0)
  let out
  try {
    out = eval(calcstr)
  } catch(err) {
    console.log('error on eval', err)
  }
  console.log('new str', obj.calc, calcstr, values, out)
  return out
} // runCalc

// parses text (like description) to match regexpes, stores data in object
function parseText(values, text, regs)
{
  // make sure we have something to parse
  if (!text.length)
    return values

  // loop through regexp objs
  for (const obj of regs)
  {
    let match = obj.re.exec(text)
    console.log('parsetext', text, obj.names, obj.re, typeof match, match)

    // find the matches and assign to values when there's data
    if (match)
      for (let i = 1; i < match.length; i++)
        // if we don't already have a value, and our i is an int, and we have data to store
        if (!values[obj.names[(i-1) % obj.names.length]] &&
        Number.isInteger(i) && typeof match[i] !== 'undefined' && match[i].length)
          values[obj.names[(i-1) % obj.names.length]] = match[i].trim()
  }
  return values
} // parseText


})() //
