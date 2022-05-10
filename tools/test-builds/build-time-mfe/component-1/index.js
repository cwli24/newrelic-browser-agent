// import {BrowserAgent} from '@newrelic/browser-agent/cjs' // should import cjs modules, should not code-splitting
// import {BrowserAgent} from '@newrelic/browser-agent/bundled' // should import bundled code (umd), with lib namespace of 'NRBA'
// import {BrowserAgent} from '@newrelic/browser-agent/umd' // should import umd modules, should allow code-splitting
// import {BrowserAgent} from '@newrelic/browser-agent/es' // should import es modules, should allow code-splitting
import {BrowserAgent} from '@newrelic/browser-agent' // should import es modules, should allow code-splitting
// const { BrowserAgent } = require('@newrelic/browser-agent') // should import cjs, should not allow code-splitting

console.log(BrowserAgent)

const nrConfig = {
  ...NREUM.init,
   ...NREUM.info, 
   ...NREUM.loader_config, 
  // licenseKey: 'asdf',
  applicationID: 1
}
const nr = new BrowserAgent()
nr.start(nrConfig).then(() => {
  console.log("agent initialized! -- COMPONENT-1", nrConfig)
  window.nr1 = nr
})

class PuppyComponent extends HTMLElement {
  constructor() {
    super()
    this.shadow = this.attachShadow({ mode: 'open' })
    this.elem = document.createElement('img')
    this.shadow.addEventListener("click", () => {
      nr.noticeError(new Error('Component 1 Error'))
      // throw new Error('Component 1 Error')
    })
    this.name = 'Puppy Component'
    this.setImg()
  }

  fetchImg = async () => {
    const params = { api_key: 'TMWFkdtKTv6To8CjL9OqC2KBNQTM8D3N', q: 'puppy', limit: 100 };
    const url = new URL(`https://api.giphy.com/v1/gifs/search`)
    Object.keys(params).forEach(key => url.searchParams.append(key, params[key]))
    const resp = await fetch(url)
    const json = await resp.json()
    const result = json.data.length > 0 ? json.data[Math.floor(Math.random() * json.data.length)].images.downsized.url : 'https://media.giphy.com/media/3zhxq2ttgN6rEw8SDx/giphy.gif';
    return result
  }

  setImg = async () => {
    const img = await this.fetchImg()
    this.elem.src = img
    this.elem.style.maxWidth = "100vw"
    this.shadow.appendChild(this.elem)
    setTimeout(() => this.sendError(), 2000)
  }

  sendError = () => {
    nr.noticeError(new Error(`${this.name} called noticeError()`))
  }
}
customElements.define('puppy-component', PuppyComponent)

export function mount(){
  const root = document.body
  const webComponent = document.createElement('puppy-component')
  
  root.appendChild(webComponent)
}