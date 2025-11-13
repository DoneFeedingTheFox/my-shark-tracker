// App.jsx
import "./App.css";
import SharkMap from "./SharkMap";

function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-title">
          <span className="logo">🦈</span>
          <div>
            <h1>Shark Tracker</h1>
            <p className="sub">Live location & movement</p>
          </div>
        </div>
      </header>

      <main className="app-main">
        <section className="panel">
          <SharkMap />
        </section>
      </main>

      <footer className="app-footer">
        <span>Shark Tracker · Luna</span>
        <span>Backend: https://shark-backend-yz6s.onrender.com</span>
      </footer>
    </div>
  );
}

export default App;
