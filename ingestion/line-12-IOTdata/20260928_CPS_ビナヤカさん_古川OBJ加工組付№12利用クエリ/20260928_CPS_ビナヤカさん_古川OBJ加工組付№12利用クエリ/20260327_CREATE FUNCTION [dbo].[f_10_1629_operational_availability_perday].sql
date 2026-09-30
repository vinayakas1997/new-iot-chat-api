USE [somic]
GO

/****** Object:  UserDefinedFunction [dbo].[f_10_1629_operational_availability_perday]    Script Date: 2026/03/27 10:57:56 ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO


/*********************************************************************/
CREATE OR ALTER FUNCTION [dbo].[f_10_1629_operational_availability_perday]( /*change*/
	@date DATE
)RETURNS @table TABLE(
	[設備コード] VARCHAR(9)
	, [勤務日付軸] DATE
	, [年] VARCHAR(4)
	, [月] VARCHAR(2)
	, [日] VARCHAR(2)
	, [勤務体制] VARCHAR(4)
	, [AB直]  VARCHAR(4)
	, [生産数] INT
	, [正味時間] NUMERIC(7,2)
	, [実績コード] INT
	, [作業実績] VARCHAR(50)
	, [負荷時間] NUMERIC(10, 1)
	, [可動率] NUMERIC(7, 1)
	, [時間当出来高] INT
)
AS
BEGIN
	WITH a AS (
		SELECT
			a.勤務日付軸
			, a.勤務体制
			, SUM(a.実績時間 * a.符号フラグ) AS [負荷時間]
		FROM
			somic.dbo.f_10_1629_loading_time(@date) AS a /*change*/
		GROUP BY
			a.勤務日付軸
			, a.勤務体制
	)

	, q AS (
		SELECT
			q.設備コード
			, q.勤務日付軸
			, q.勤務体制
			, dbo.f_check_shift_A_or_B(q.勤務日付軸,q.勤務体制) AS [AB直]
			, SUM(q.総生産数) AS [生産数]
			, SUM(q.正味時間) AS [正味時間]
		FROM
			somic.dbo.f_10_1629_quality_goods_number_perday(@date) AS q /*change*/
		GROUP BY
			q.設備コード
			, q.勤務日付軸
			, q.勤務体制
	)

	INSERT INTO @table(
		[設備コード]
		, [勤務日付軸]
		, [年]
		, [月]
		, [日]
		, [勤務体制]
		, [AB直]
		, [生産数]
		, [正味時間]
		, [実績コード]
		, [作業実績]
		, [負荷時間]
		, [可動率]
		, [時間当出来高])
	SELECT
		'10-1629'
		, q.勤務日付軸
		, FORMAT(q.勤務日付軸, 'yyyy')
		, FORMAT(q.勤務日付軸, 'MM')
		, FORMAT(q.勤務日付軸, 'dd')
		, q.勤務体制
		, q.AB直
		, q.生産数
		, q.正味時間
		, 130
		, '設備時間'
		, a.[負荷時間]
		, ROUND((q.正味時間 / a.[負荷時間]) *100, 1) AS [可動率]
		, FLOOR((q.生産数 / a.[負荷時間]) *60 *60) AS [時間当出来高]
	FROM
		q
		LEFT JOIN a
			ON q.勤務日付軸 = a.勤務日付軸
			AND q.勤務体制 = a.勤務体制
	;
	RETURN
END;
GO


