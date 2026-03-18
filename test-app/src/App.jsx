import { useEffect, useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from './assets/vite.svg'
import heroImg from './assets/hero.png'
import './App.css'

const PRODUCTS = Array.from({ length: 320 }, (_, index) => {
  const id = index + 1
  const category = ['analytics', 'billing', 'search', 'ops'][index % 4]
  const region = ['seoul', 'tokyo', 'london', 'newyork'][index % 4]
  const tier = ['starter', 'growth', 'scale'][index % 3]

  return {
    id,
    name: `Product ${id}`,
    category,
    region,
    tier,
    usage: (id * 17) % 100,
    alerts: (id * 7) % 5,
  }
})

function formatScore(product, query) {
  let checksum = 0
  const seed = `${product.name}|${product.category}|${product.region}|${query}`

  for (let repeat = 0; repeat < 250; repeat += 1) {
    for (let index = 0; index < seed.length; index += 1) {
      checksum = (checksum + seed.charCodeAt(index) * (repeat + 3)) % 100003
    }
  }

  return checksum % 100
}

function ResultRow({ product, query, selectedId, onSelect }) {
  const loadScore = formatScore(product, query)
  const accent = loadScore > 50 ? 'warning' : 'healthy'
  const details = {
    name: product.name,
    region: product.region.toUpperCase(),
    tier: product.tier,
    accent,
  }

  return (
    <li className="result-row" data-product-id={product.id}>
      <button
        type="button"
        className={selectedId === product.id ? 'result-card active' : 'result-card'}
        onClick={() => onSelect(product.id)}
      >
        <div className="row-topline">
          <strong>{details.name}</strong>
          <span className={`pill ${accent}`}>{details.region}</span>
        </div>
        <p className="row-copy">
          {product.category} / {details.tier}
        </p>
        <div className="row-metrics">
          <span>Usage {product.usage}%</span>
          <span>Alerts {product.alerts}</span>
          <span>Score {loadScore}</span>
        </div>
      </button>
    </li>
  )
}

function ResultList({ products, query, selectedId, onSelect }) {
  return (
    <ul className="result-list">
      {products.map((product) => (
        <ResultRow
          key={product.id}
          product={product}
          query={query}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </ul>
  )
}

function SlowSearchDemo() {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(12)

  const filteredProducts = PRODUCTS.filter((product) => {
    const haystack =
      `${product.name} ${product.category} ${product.region} ${product.tier}`.toLowerCase()

    return haystack.includes(query.toLowerCase())
  }).map((product) => ({
    ...product,
    badge: `${product.category}-${query.length}`,
  }))

  const selectedProduct =
    filteredProducts.find((product) => product.id === selectedId) ?? filteredProducts[0] ?? null

  return (
    <section id="slow-search-demo">
      <div className="demo-shell">
        <div className="demo-copy">
          <p className="eyebrow">Intentional bottleneck</p>
          <h2>Slow Search Demo</h2>
          <p>
            Typing in this input updates parent state, rebuilds the filtered list,
            and re-renders every visible row.
          </p>
        </div>

        <div className="search-toolbar">
          <label className="search-field">
            <span>Filter inventory</span>
            <input
              type="text"
              placeholder="Type to filter products"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="search-stats">
            <p>Results: {filteredProducts.length}</p>
            <p>Query length: {query.length}</p>
            <p>Selected: {selectedProduct ? selectedProduct.name : 'None'}</p>
          </div>
        </div>

        <ResultList
          products={filteredProducts}
          query={query}
          selectedId={selectedProduct?.id ?? null}
          onSelect={(id) => setSelectedId(id)}
        />
      </div>
    </section>
  )
}

function App() {
  const [count, setCount] = useState(0)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTick((value) => value + 1)
    }, 12000)

    return () => {
      window.clearInterval(timer)
    }
  }, [])

  return (
    <>
      <section id="center">
        <div className="hero">
          <img src={heroImg} className="base" width="170" height="179" alt="" />
          <img src={reactLogo} className="framework" alt="React logo" />
          <img src={viteLogo} className="vite" alt="Vite logo" />
        </div>
        <div className="hero-copy">
          <h1>Agent React Debug Lab</h1>
          <p>
            Edit <code>src/App.jsx</code> and use <code>rdt</code> to inspect the
            intentional slow-search bottleneck below.
          </p>
        </div>
        <button
          className="counter"
          onClick={() => setCount((value) => value + 1)}
        >
          Count is {count}
        </button>
        <p>Auto tick: {tick}</p>
      </section>

      <div className="ticks"></div>
      <SlowSearchDemo />

      <div className="ticks"></div>

      <section id="next-steps">
        <div id="docs">
          <svg className="icon" role="presentation" aria-hidden="true">
            <use href="/icons.svg#documentation-icon"></use>
          </svg>
          <h2>Inspection prompts</h2>
          <p>Try searching for these component names with rdt:</p>
          <ul className="prompt-list">
            <li>SlowSearchDemo</li>
            <li>ResultList</li>
            <li>ResultRow</li>
          </ul>
        </div>
        <div id="social">
          <svg className="icon" role="presentation" aria-hidden="true">
            <use href="/icons.svg#social-icon"></use>
          </svg>
          <h2>Suggested workflow</h2>
          <p>Collect a snapshot, inspect the list, then profile a single input change.</p>
          <ul className="prompt-list">
            <li>tree get</li>
            <li>node search</li>
            <li>node inspect</li>
            <li>profiler summary</li>
          </ul>
        </div>
      </section>

      <div className="ticks"></div>
      <section id="spacer"></section>
    </>
  )
}

export default App
