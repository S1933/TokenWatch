import { Route, Routes } from "react-router-dom";
import { Header } from "./components/Header.js";
import { Dashboard } from "./pages/Dashboard.js";
import { AccountsList } from "./pages/AccountsList.js";
import { AccountDetails } from "./pages/AccountDetails.js";

export function App(): JSX.Element {
  return (
    <div className="min-h-full flex flex-col">
      <Header />
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/accounts" element={<AccountsList />} />
          <Route path="/accounts/:id" element={<AccountDetails />} />
        </Routes>
      </main>
    </div>
  );
}
