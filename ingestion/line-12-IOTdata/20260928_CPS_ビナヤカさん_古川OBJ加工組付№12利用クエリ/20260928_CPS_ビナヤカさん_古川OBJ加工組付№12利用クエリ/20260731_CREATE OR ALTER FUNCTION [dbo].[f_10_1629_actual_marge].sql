USE [somic]
GO

/****** Object:  UserDefinedFunction [dbo].[f_10_1629_gantt_chart_fill_gaps]    Script Date: 2026/07/29 16:18:13 ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO


--2026.7.31作成：秋田 異常停止時間結合したいため作成
CREATE OR ALTER FUNCTION [dbo].[f_10_1629_actual_marge](
	@date DATE
)RETURNS TABLE
AS
RETURN(
WITH Base AS(
	SELECT
		t.Machine_Code AS [設備コード]
		, @date AS [勤務日付軸] 
		, somic.dbo.f_get_time_axis(t.INSERT_DATE, t.Time_system, DEFAULT) AS [時間帯]
		, somic.dbo.f_check_shift_day_or_night_OP_plan(t.INSERT_DATE,t.Machine_Code) AS [勤務体制] --AB_SECTION_DATEが入力次第で変わるのでINSERT_DATEで判定
		, DATEADD(MILLISECOND, (t.Code_Timer*-100) ,t.INSERT_DATE) AS [開始日時]
		, t.INSERT_DATE AS [終了日時]
		, LAG(t.INSERT_DATE) OVER (
			PARTITION BY t.ActualCode
			ORDER BY t.INSERT_DATE
		  ) AS [前回終了日時]
		, CASE
			WHEN t.ActualCode=100 OR t.ActualCode=110 OR t.ActualCode=111 THEN '設備'
			ELSE CAST(t.Operater AS VARCHAR(6))
		END AS [作業者]
		, ac.actual_instance AS [実績コード] --結合行として表示
--		, t.Code_Timer/10 AS [作業時間]　作業時間は結合後計算しなおし
	FROM
		somic.dbo.AM307A_ACTUAL_PRODUCTION_1 AS t WITH(NOLOCK) /*change*/

	LEFT JOIN dbo.m_actual_codes AS ac WITH(NOLOCK)
		ON t.ActualCode = ac.actual_code

	WHERE
		t.AB_SECTION_DAY = @date
		AND t.Flg_Actual = 0
	),

Gr AS (
	SELECT
		b.[設備コード]
		, b.[勤務日付軸] 
--		, b.[時間帯]
		, b.[勤務体制]
		, b.[開始日時]
		, b.[終了日時]
		, b.[前回終了日時]
		, b.[作業者]
		, b.[実績コード]
		,SUM(
			CASE
				WHEN
					b.[前回終了日時] IS NULL
					OR ABS(DATEDIFF(SECOND,b.[前回終了日時],b.[開始日時])) >2
				THEN 1
				ELSE 0
			END
			) OVER (
				PARTITION BY b.[実績コード]
				ORDER BY b.[開始日時]
				ROWS UNBOUNDED PRECEDING
			) AS [結合範囲]
	FROM
		Base b
)
SELECT
	g.[設備コード]
	, g.[勤務日付軸] 
--	, g.[時間帯]
	, g.[勤務体制]
	, MIN(g.[開始日時]) AS [開始日時]
	, MAX(g.[終了日時]) AS [終了日時]
--	, g.[前回終了日時]
	, g.[作業者]
	, g.[実績コード]
	, DATEDIFF(MILLISECOND,MIN(g.[開始日時]),MAX(g.[終了日時]))/1000.0 AS [作業時間]
	--実績時間は計算しなおし
--	, g.[結合範囲]
FROM
	Gr g
GROUP BY
	g.[設備コード]
	, g.[勤務日付軸] 
--	, g.[時間帯]
	, g.[勤務体制]
	, g.[作業者]
	, g.[実績コード]
	, g.[結合範囲]
)
;
GO