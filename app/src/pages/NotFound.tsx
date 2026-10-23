import { Link } from "react-router-dom";

/** A page that isn't there: say so, and lead back. */
export default function NotFound() {
  return (
    <div className="wrap narrow" style={{ paddingTop: "12vh" }}>
      <h1 className="title">Nothing here</h1>
      <p className="lede">This address isn't a page of Wimym. <Link className="link" to="/">Go to this week</Link>.</p>
    </div>
  );
}
