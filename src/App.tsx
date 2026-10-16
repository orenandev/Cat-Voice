import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import Login from "./pages/Login";
import Home from "./pages/Home";
import CreateRoom from "./pages/CreateRoom";
import JoinRoom from "./pages/JoinRoom";
import RoomPage from "./pages/Room";
import Packs from "./pages/Packs";

function Protected() {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <div className="login">
        <Spinner size={22} />
      </div>
    );
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Layout />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Protected />}>
        <Route path="/" element={<Home />} />
        <Route path="/nova-sala" element={<CreateRoom />} />
        <Route path="/entrar" element={<JoinRoom />} />
        <Route path="/entrar/:code" element={<JoinRoom />} />
        <Route path="/sala/:id" element={<RoomPage />} />
        <Route path="/packs" element={<Packs />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
