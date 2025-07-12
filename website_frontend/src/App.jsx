import { Routes, Route } from "react-router-dom";

import HomePage from "./pages/HomePage";
import TrackingPage from "./pages/TrackingPage";
import SystemPage from "./pages/SystemPage";
import Header from "./components/Header";

import ScrollToTop from "./helpers/ScrollToTop";

import "./styles/datepicker.css";

function App() {
  return (
    <div className="bg-gray-100 min-h-screen text-gray-800 font-roboto">
      <ScrollToTop />
      <Header />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/tracking" element={<TrackingPage />} />
        <Route path="/:serviceTag" element={<SystemPage />} />
      </Routes>
    </div>
  );
}

export default App;
