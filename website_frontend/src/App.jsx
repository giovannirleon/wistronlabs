import { Routes, Route } from "react-router-dom";

import TrackingPage from "./pages/TrackingPage";
import StationPage from "./pages/StationPage";
import SystemPage from "./pages/SystemPage";
import Header from "./components/Header";
import Footer from "./components/Footer";
import Auth from "./pages/Auth";
import ProtectedRoute from "./components/ProtectedRoute";
import UserPage from "./pages/UserPage";
import ResetPassword from "./pages/ResetPassword";
import HistoryPage from "./pages/HistoryPage";
import AdminPage from "./pages/AdminPage";

import ScrollToTop from "./helpers/ScrollToTop";

import "./styles/datepicker.css";
import { useEffect } from "react";
import ShippingPage from "./pages/ShippingPage";

function App() {
  const LOCATION = import.meta.env.VITE_LOCATION;

  useEffect(() => {
    document.title = `${LOCATION} Dashboard`;
  }, []);

  return (
    <>
      <div className="bg-gray-100 min-h-screen text-gray-800 font-roboto pb-10">
        {/* <ScrollToTop /> */}
        <Header />
        <Routes>
          <Route path="/" element={<TrackingPage />} />
          <Route path="/stations" element={<StationPage />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/shipping" element={<ShippingPage />} />
          <Route path="/:serviceTag" element={<SystemPage />} />
          <Route
            path="/user"
            element={
              <ProtectedRoute>
                <UserPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <AdminPage />
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
