export function BonusCoins({ compact = false }) {
  return (
    <div className={compact ? "bonus-coins bonus-coins-compact" : "bonus-coins"} aria-hidden="true">
      <div className="bonus-coin bonus-coin-back"><span>¥</span></div>
      <div className="bonus-coin bonus-coin-front"><span>¥</span></div>
      <i className="bonus-spark bonus-spark-one">✦</i>
      <i className="bonus-spark bonus-spark-two">✦</i>
    </div>
  );
}
