import { memo } from "react";
import { ColumnMeta, Row, Widget } from "@/lib/types";
import BarChart from "./BarChart";
import LineChart from "./LineChart";
import Donut from "./Donut";
import Kpi from "./Kpi";
import DataTable from "./DataTable";
import PivotTable from "./PivotTable";
import TextBlock from "./TextBlock";
import HeatmapChart from "./HeatmapChart";
import ScatterChart from "./ScatterChart";
import GaugeChart from "./GaugeChart";
import CategoryGrid from "./CategoryGrid";

interface Props {
  widget: Widget;
  rows: Row[];
  columns: ColumnMeta[];
  scale?: number;
  editable?: boolean;
  onTextChange?: (text: string) => void;
}

function WidgetBody({ widget, rows, columns, scale = 1, editable, onTextChange }: Props) {
  const props = { widget, rows, columns, scale };
  switch (widget.type) {
    case "bar":
      return <BarChart {...props} />;
    case "line":
      return <LineChart {...props} filled={false} />;
    case "area":
      return <LineChart {...props} filled={true} />;
    case "pie":
      return <Donut {...props} />;
    case "kpi":
      return <Kpi {...props} />;
    case "table":
      return <DataTable {...props} />;
    case "pivot":
      return <PivotTable {...props} />;
    case "text":
      return <TextBlock {...props} editable={editable} onTextChange={onTextChange} />;
    case "heatmap":
      return <HeatmapChart {...props} />;
    case "scatter":
      return <ScatterChart {...props} />;
    case "gauge":
      return <GaugeChart {...props} />;
    case "map":
      return <CategoryGrid {...props} />;
    default:
      return null;
  }
}

export default memo(WidgetBody);
