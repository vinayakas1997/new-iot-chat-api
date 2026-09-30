USE [somic]
GO

/****** Object:  UserDefinedFunction [dbo].[f_10_1629_quality_goods_number_perday]    Script Date: 2026/06/02 10:34:26 ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO


/*********************************************************************/
--2026.6.2変更：秋田 早出対応
CREATE OR ALTER FUNCTION [dbo].[f_10_1629_quality_goods_number_perday_](
	@date DATE
)
RETURNS @table TABLE(
	[設備コード] VARCHAR(9)
	, [勤務日付軸] DATE
	, [勤務体制] VARCHAR(4)
	, [総生産数] INT
	, [正味時間] NUMERIC(10,2)
)
AS 
BEGIN
	DECLARE
		@unitCode VARCHAR(20) = '10-1629' /*change*/
		, @machineNo VARCHAR(20) = 'AM-307A' /*change*/
	;

	INSERT INTO @table
	SELECT
		t.Machine_Code	--[設備コード]
		, COALESCE(c.[勤務日付軸],t.AB_SECTION_DAY)	--[勤務日付軸]
		--勤務体制が早出に対応していないため変更
		, dbo.f_check_shift_day_or_night_type_early_in(t.AB_SECTION_DAY,t.INSERT_DATE)	--[勤務体制]
		, SUM(t.Work_QTY_H)	--[時間当生産数]
		, SUM(t.Work_QTY_H * wn.ct)	--[正味時間]

	FROM(
		SELECT DISTINCT *
		FROM somic.dbo.AM307A_QUALITY_GOODS_NUMBER_1 WITH(NOLOCK) /*change*/
		) AS t

		INNER JOIN dbo.m_work_names AS wn WITH(NOLOCK)
			ON wn.unit_code = @unitCode
			AND wn.machine_no =
				CASE
					WHEN wn.machine_no = '' THEN wn.machine_no
					ELSE @machineNo
				END
			AND t.Work_No = wn.work_no
			AND wn.begin_date <= @date
			AND wn.end_date >= @date

		LEFT JOIN f_10_1629_check_date_monthly(@date) AS c
			ON t.INSERT_DATE BETWEEN c.[開始時刻] AND c.[終了時刻]

	WHERE
		t.AB_SECTION_DAY BETWEEN DATEADD(DAY, 1, EOMONTH(@date, -1)) AND EOMONTH(@date)
		AND (t.Hour_Check = 1 OR t.Hour_Check = 2 OR t.Hour_Check = 3)

	GROUP BY
		t.Machine_Code
		, COALESCE(c.[勤務日付軸],t.AB_SECTION_DAY)
		--勤務体制が早出に対応していないため変更
		, dbo.f_check_shift_day_or_night_type_early_in(t.AB_SECTION_DAY,t.INSERT_DATE)
	RETURN
END;
GO


