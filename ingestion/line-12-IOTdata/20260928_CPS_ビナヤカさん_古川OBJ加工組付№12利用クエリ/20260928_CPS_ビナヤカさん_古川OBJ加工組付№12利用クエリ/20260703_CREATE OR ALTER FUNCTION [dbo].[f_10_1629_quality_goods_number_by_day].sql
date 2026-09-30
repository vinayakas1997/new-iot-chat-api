USE [somic]
GO

/****** Object:  UserDefinedFunction [dbo].[f_10_1629_quality_goods_number_by_day]    Script Date: 2026/07/03 13:33:07 ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

/*朝会(良品生産実績)のためのデータソース*/--2026.7.3作成：秋田　トヨタ自主研の中での標準化
CREATE OR ALTER FUNCTION [dbo].[f_10_1629_quality_goods_number_by_day]( /*change*/
	@date DATE
)
RETURNS @table TABLE(
	[設備コード] VARCHAR(9)
	, [勤務日付軸] DATE
	, [日付] VARCHAR(10)
	, [勤務体制] VARCHAR(4)
	, [時間帯] VARCHAR(5)
	, [機種] TINYINT
	, [背番号] VARCHAR(50)
	, [目標数] INT
	, [時間当生産数] INT
	, [CT] NUMERIC(8,2)
	, [正味時間] NUMERIC(8,2)
)
AS
BEGIN
	DECLARE
		@unitCode VARCHAR(10) = '10-1629' /*change*/
		, @machineNo VARCHAR(10) = 'AM-307A' /*change*/
	;

	INSERT INTO @table
	SELECT
		t.Machine_Code --[設備コード]
		, t.AB_SECTION_DAY --[勤務日付軸]
		, FORMAT(t.INSERT_DATE, 'yyyy-MM-dd') AS [日付]
		, somic.dbo.f_check_shift_day_or_night_type_early_in(t.ab_section_day,t.INSERT_DATE) --[勤務体制]
		, somic.dbo.f_get_time_axis(t.INSERT_DATE, t.Time_system, t.Hour_Check) --[時間帯]
		, t.Work_No --[機種]
		, wn.work_name --[背番号]
		, t.Target_QTY AS [目標数]
		, t.Work_QTY_H --[時間当生産数]
		, wn.ct --[CT]
		, t.Work_QTY_H * wn.ct --[正味時間]
	FROM
		somic.dbo.AM307A_QUALITY_GOODS_NUMBER_1 AS t WITH(NOLOCK) /*change*/

		INNER JOIN somic.dbo.m_work_names AS wn WITH(NOLOCK)
			ON wn.unit_code = @unitCode
			AND wn.machine_no =
				CASE
					WHEN wn.machine_no = '' THEN wn.machine_no
					ELSE @machineNo
				END
			AND t.Work_No = wn.work_no
			AND wn.begin_date <= @date
			AND wn.end_date >= @date
	WHERE
		t.AB_SECTION_DAY = @date
		AND (t.Hour_Check = 1 OR t.Hour_Check = 2 OR t.Hour_Check = 3)

	RETURN
END;
GO