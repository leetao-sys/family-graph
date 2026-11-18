import { useState } from "react";
import { useAuth } from "../auth";
import KinshipCalculator from "../components/KinshipCalculator";
import { PageHeading } from "../ui";
import type { PersonBrief } from "../types";

export default function Kinship() {
  const { user } = useAuth();
  const [a, setA] = useState<PersonBrief | null>(user?.person ?? null);
  const [b, setB] = useState<PersonBrief | null>(null);
  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <PageHeading mark="称" title="称呼考" sub="A 称呼 B 为什么？" />
      <div className="card">
        <div className="card-body">
          <KinshipCalculator
            a={a}
            b={b}
            onChange={(x, y) => {
              setA(x);
              setB(y);
            }}
          />
        </div>
      </div>
      <p className="muted small" style={{ marginTop: 12 }}>
        称谓基于族谱关系（亲子、配偶、兄弟姐妹）计算，默认使用普通话通用称谓。若结果与实际不符，通常是族谱数据有误，请联系管理员更正。
      </p>
    </div>
  );
}
