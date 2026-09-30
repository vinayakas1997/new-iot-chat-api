USE [somic]
GO

/****** Object:  UserDefinedFunction [dbo].[f_10_1629_error_history_daily_alarm_timer]    Script Date: 2026/08/31 17:39:43 ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO





--2026.6.30修正：秋田　時間が見たいがST,機種背番号分重複してしまうので修正
--2026.7.9作成：秋田　処置時間もいれる
--2026.8.5修正：秋田　異常処置までを呼出時間(運転中異常)とする
--2026.8.31 作業時間をf_10_1629_actual_margeで秒に変換していたので修正
CREATE OR ALTER   FUNCTION [dbo].[f_10_1629_error_history_daily_alarm_timer]( /*change*/
	@date DATE
)RETURNS @t TABLE(
	[勤務日付軸] DATE
	, [勤務体制] VARCHAR(4)
	, [時間帯] VARCHAR(5)
	, [日付] VARCHAR(10)
	, [呼出開始時刻] VARCHAR(8)
	, [呼出終了時刻] VARCHAR(8)
	, [処置開始時刻] VARCHAR(8)
	, [処置終了時刻] VARCHAR(8)
	, [機番] VARCHAR(9)
	, [運転モード] VARCHAR(9)
	, [№] INT
	, [異常内容] VARCHAR(200)
	, [呼出時間] NUMERIC(10, 2)
	, [処置時間] NUMERIC(10, 2)
	, [呼出(分)] NUMERIC(10, 2)
	, [処置(分)] NUMERIC(10, 2)
	, [重複確認] INT
)
BEGIN
	DECLARE
		@unitCode VARCHAR(10) = '10-1629' /*change*/
    ;
	INSERT INTO @t
	SELECT
		t.AB_SECTION_DAY AS [勤務日付軸]
		, somic.dbo.f_check_shift_day_or_night(t.INSERT_DATE) AS [勤務体制]
		, somic.dbo.f_get_time_axis(t.INSERT_DATE, t.Time_system, DEFAULT) AS [時間帯]
		, FORMAT(DATEADD(SECOND,-t.AlarmTime /10.0,t.INSERT_DATE), 'yyyy-MM-dd') AS [日付]
		, FORMAT(t.INSERT_DATE, 'HH:mm:ss') AS [呼出開始時刻]
		, FORMAT(ISNULL(ac.[開始日時],ISNULL(er2.INSERT_DATE,t.INSERT_DATE)), 'HH:mm:ss') AS [呼出終了時刻]
		, FORMAT(ac.[開始日時], 'HH:mm:ss') AS [処置開始時刻]
		, FORMAT(ac.[終了日時], 'HH:mm:ss') AS [処置終了時刻]
		, t.Machine_No AS [機番]
		, sm.mode_instance AS [運転モード]
		, t.errorcode AS [№]
		, ISNULL(ec.error_instance, '未登録') AS [異常項目]
		--, er2.AlarmTime /10.0 AS [呼出時間]　2026.8.5修正：秋田
		,DATEDIFF(SECOND,t.INSERT_DATE,ISNULL(ac.[開始日時],ISNULL(er2.INSERT_DATE,t.INSERT_DATE))) AS [呼出時間]
		, ac.[作業時間] AS [処置時間]
		--2026.8.31 作業時間をf_10_1629_actual_margeで秒に変換していたので修正
		--, er2.AlarmTime /600.0 AS [呼出(分)]　2026.8.5修正：秋田
		,DATEDIFF(SECOND,t.INSERT_DATE,ISNULL(ac.[開始日時],ISNULL(er2.INSERT_DATE,t.INSERT_DATE)))/60.0 AS [呼出(分)]
		, ac.[作業時間]/60.0 AS [処置(分)]
		--2026.8.31 作業時間をf_10_1629_actual_margeで秒に変換していたので修正
		, ROW_NUMBER() OVER(
			PARTITION BY t.INSERT_DATE, t.errorcode
			ORDER BY er2.INSERT_DATE DESC
			) AS [重複確認]

	FROM
		somic.dbo.L10_1629_ERROR_HISTORY_1 AS t WITH(NOLOCK)
		LEFT JOIN (
			SELECT
				INSERT_DATE
				,AlarmTime
			FROM
				L10_1629_ERROR_HISTORY_1 WITH(NOLOCK)
			WHERE
				AB_SECTION_DAY = @date AND Flg_Error <> 1
			)AS er2 ON ABS(DATEDIFF(MILLISECOND,t.INSERT_DATE,DATEADD(MILLISECOND,-er2.AlarmTime*100,er2.INSERT_DATE))) < 600
		LEFT JOIN (
			SELECT
				*
			FROM
				f_10_1629_actual_marge(@date)
			WHERE
				 実績コード = '異常停止時間'
			)AS ac
			ON t.INSERT_DATE < ac.[開始日時]
			AND DATEDIFF(SECOND,er2.INSERT_DATE,ac.[開始日時]) < 2
		LEFT JOIN somic.dbo.m_select_modes AS sm
			ON sm.select_mode = t.select_mode
		LEFT JOIN somic.dbo.m_error_codes AS ec
			ON ec.unit_code = @unitCode
			AND ec.machine_no = t.machine_no
			AND ec.error_code = t.errorcode
			AND ec.begin_date <= t.AB_SECTION_DAY
			AND ec.end_date >= t.AB_SECTION_DAY
	WHERE
		t.AB_SECTION_DAY = @date
		AND t.[Error_Mode] = 2 --1:起動時異常(warning), 2:運転中異常(alarm)
		AND t.[Flg_Error] = 1
	RETURN
END
GO


