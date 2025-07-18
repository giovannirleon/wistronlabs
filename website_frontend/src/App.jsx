import { Routes, Route } from "react-router-dom";

import HomePage from "./pages/HomePage";
import TrackingPage from "./pages/TrackingPage";
import SystemPage from "./pages/SystemPage";
import Header from "./components/Header";
import Footer from "./components/Footer";
import Auth from "./pages/Auth";
import ProtectedRoute from "./components/ProtectedRoute";
import UserPage from "./pages/UserPage";
import ResetPassword from "./pages/ResetPassword";
import HistoryPage from "./pages/HistoryPage";

import ScrollToTop from "./helpers/ScrollToTop";

import "./styles/datepicker.css";

function App() {
  return (
    <>
      <div className="bg-gray-100 min-h-screen text-gray-800 font-roboto pb-10">
        {/* <ScrollToTop /> */}
        <Header />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/tracking" element={<TrackingPage />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/:serviceTag" element={<SystemPage />} />
          <Route
            path="/user"
            element={
              <ProtectedRoute>
                <UserPage />
              </ProtectedRoute>
            }
          />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/locationHistory/:id" element={<HistoryPage />} />
        </Routes>
      </div>
      <Footer className="mt-10" />
    </>
  );
}

export default App;
