import SharkMap from "./SharkMap";

function App() {
  return (
    <div style={{ padding: "1rem" }}>
      <h1>My Shark Tracker</h1>
      <p>
        This shows the path of a tagged shark using our demo data for Luna.
      </p>
      <SharkMap />
    </div>
  );
}

export default App;
