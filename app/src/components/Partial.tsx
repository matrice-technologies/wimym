import { Link } from "react-router-dom";
import { fmtN } from "../lib/format";
import type { Coverage } from "../lib/types";

/** Said in place of a view whose labels cover too few of your messages yet. */
export default function Partial({ c, what }: { c: Coverage; what: string }) {
  return (
    <p className="partial">
      {what} {c.labelled ? <>are labelled on {fmtN(c.labelled)} of your {fmtN(c.of)} messages so far</> : <>aren't labelled yet</>}: this shows once they cover most of them.{" "}
      <Link className="link" to="/labels">What the labels mean</Link>
    </p>
  );
}
