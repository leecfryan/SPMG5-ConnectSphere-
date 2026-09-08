import { useState, useEffect } from "react";
import "./App.css";

function App() {
  const [message, setMessage] = useState("Loading...");

  useEffect(() => {
    fetch("http://localhost:3000/api/health")
      .then((response) => response.json())
      .then((data) => setMessage(data.message))
      .catch((error) => console.error("Error fetching health status:", error));
  }, []);
  return (
    <>
      <h1>{message}</h1>
    </>
  );
}

export default App;
