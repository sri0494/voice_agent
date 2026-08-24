import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../services/api.js";
import StatusBadge from "../components/StatusBadge.jsx";
import { LoadingState, ErrorState, EmptyState } from "../components/DataState.jsx";

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [state, setState] = useState("loading");
  const [q, setQ] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ firstName: "", lastName: "", mobile: "", email: "", city: "" });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setState("loading");
    try {
      setCustomers(await api.getCustomers(q ? { q } : {}));
      setState("ready");
    } catch {
      setState("error");
    }
  };

  useEffect(() => { load(); }, [q]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.createCustomer(form);
      setForm({ firstName: "", lastName: "", mobile: "", email: "", city: "" });
      setShowForm(false);
      load();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="section-title">Customers</div>
          <div className="section-sub">People with an established business relationship</div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>+ Add Customer</button>
      </div>

      {showForm && (
        <form className="card" onSubmit={handleCreate} style={{ marginBottom: 16, maxWidth: 480 }}>
          <div className="grid grid-cols-2">
            <div className="form-group"><label>First Name</label><input className="input" required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></div>
            <div className="form-group"><label>Last Name</label><input className="input" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></div>
          </div>
          <div className="form-group"><label>Mobile Number</label><input className="input" required placeholder="9876543210" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} /></div>
          <div className="form-group"><label>Email</label><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div className="form-group"><label>City</label><input className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
          <button className="btn btn-primary" disabled={saving}>{saving ? "Creating..." : "Create Customer"}</button>
        </form>
      )}

      <input className="input" placeholder="Search by name, mobile, or email..." style={{ maxWidth: 340, marginBottom: 16 }} value={q} onChange={(e) => setQ(e.target.value)} />

      {state === "loading" && <LoadingState label="Loading customers..." />}
      {state === "error" && <ErrorState onRetry={load} />}
      {state === "ready" && customers.length === 0 && <EmptyState message="No customers yet." />}

      {state === "ready" && customers.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Mobile</th><th>Email</th><th>City</th><th>Status</th><th>Assigned Agent</th></tr></thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id}>
                  <td><Link to={`/customers/${c.id}`} style={{ color: "var(--cyan)", fontWeight: 600 }}>{c.first_name} {c.last_name || ""}</Link></td>
                  <td>{c.mobile}</td>
                  <td>{c.email || "—"}</td>
                  <td>{c.city || "—"}</td>
                  <td><StatusBadge status={c.status} /></td>
                  <td>{c.assigned_agent_name || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
