USE [somic]
GO

/****** Object:  UserDefinedFunction [dbo].[f_10_1629_actual_production_by_day]    Script Date: 2026/07/03 13:21:03 ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO


/*生産実績記録表(作業実績)のためのデータソース*/--2026.7.3作成：秋田　トヨタ自主研の中での標準化
CREATE OR ALTER FUNCTION [dbo].[f_10_1629_actual_production_by_day]( /*change*/
	@date DATE
	, @actualCode INT
)
RETURNS @table TABLE(
	[設備コード] VARCHAR(9)
	, [勤務日付軸] DATE
	, [勤務体制] VARCHAR(4)
	, [時間帯] VARCHAR(5)
	, [開始時刻] DATETIME2(3)
	, [終了時刻] DATETIME2(3)
	, [実績コード] INT
	, [作業実績] VARCHAR(50)
	, [実績時間] NUMERIC(8, 2)
)
AS
BEGIN
	WITH cte AS (
		SELECT DISTINCT
			a.INSERT_DATE AS [INSERT_DATE]
			, a.AB_SECTION_DAY AS [AB_SECTION_DAY]
			, DATEADD(millisecond, somic.dbo.f_measure_millisecond_in_time_axis(a.Code_timer *100, a.INSERT_DATE, a.Time_system) *-1, a.INSERT_DATE) AS [begin_date]
			, a.Machine_Code AS [unit_code]
			, a.ActualCode AS [ActualCode]
			, CAST(somic.dbo.f_measure_millisecond_in_time_axis(a.Code_timer *100, a.INSERT_DATE, a.Time_system) AS NUMERIC(20, 3)) AS [Code_timer]
			, CAST(a.Code_timer *100 - somic.dbo.f_measure_millisecond_in_time_axis(a.Code_timer *100, a.INSERT_DATE, a.Time_system) AS NUMERIC(20,3)) AS [Remaining_Time]
			, a.Time_system
		FROM
			somic.dbo.AM307A_ACTUAL_PRODUCTION_1 AS a WITH(NOLOCK) /*change*/
		WHERE
			a.AB_SECTION_DAY = @date
			AND a.[flg_actual] = '0'
			AND (@actualCode IS NULL OR a.ActualCode = @actualCode)
		UNION ALL
		SELECT
			b.begin_date AS [INSERT_DATE]
			, somic.dbo.f_get_date_axis(b.begin_date) AS [AB_SECTION_DAY]
			, DATEADD(MILLISECOND, somic.dbo.f_measure_millisecond_in_time_axis(b.Remaining_Time, b.begin_date, b.Time_system) *-1, b.begin_date) AS [begin_date]
			, b.unit_code AS [unit_code]
			, b.ActualCode AS [ActualCode]
			, CAST(somic.dbo.f_measure_millisecond_in_time_axis(b.Remaining_Time, b.begin_date, b.Time_system) AS NUMERIC(20, 3)) AS [Code_timer]
			, CAST(b.Remaining_Time - somic.dbo.f_measure_millisecond_in_time_axis(b.Remaining_Time, b.begin_date, b.Time_system) AS NUMERIC(20, 3)) AS [Remaining_Time]
			, b.Time_system
		FROM
			[CTE] AS b
		WHERE
			b.[Remaining_Time] > 0
	)

	INSERT INTO @table([設備コード], [勤務日付軸], [勤務体制], [時間帯], [開始時刻], [終了時刻], [実績コード], [作業実績], [実績時間])
	SELECT
		t.unit_code
		, t.AB_SECTION_DAY
		, somic.dbo.f_check_shift_day_or_night(t.begin_date)
		, somic.dbo.f_get_time_axis(t.begin_date, t.Time_system, DEFAULT)
		, t.begin_date
		, t.INSERT_DATE
		, t.ActualCode
		, ac.actual_instance
		, t.Code_timer /1000.0
	FROM
		cte AS t
		LEFT JOIN somic.dbo.m_actual_codes AS ac
			ON ac.actual_code = t.ActualCode

	RETURN
END;
GO