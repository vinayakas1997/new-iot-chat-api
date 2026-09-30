--2026.9.17作成：秋田　タッチパネルからの計画停止入力反映のため
CREATE OR ALTER VIEW v_10_1629_actual_production_add_input AS

WITH BASE AS(
SELECT
    CAST(
        CONCAT(
            CASE WHEN FLOOR([Code_Timer]/100) < 8
                THEN DATEADD(DAY,1,AB_SECTION_DAY)
                ELSE AB_SECTION_DAY
            END,' '
            ,FLOOR([Code_Timer]/100),':'
            ,RIGHT([Code_Timer],2),':00.000'
        ) AS DATETIME
    ) AS [INSERT_DATE]
    ,[INSERT_WEEK]
    ,[AB_SECTION_DAY]
    ,[Machine_Code]
    ,[Time_system]
    ,0 AS [Operater]
    ,[Operater] AS [ActualCode]
    ,CASE WHEN [Machine_No] ='Start'
        THEN 1
        ELSE [Flg_Actual]
     END AS [Flg_Actual]
    ,[Machine_No]
FROM
    AM307A_ACTUAL_PRODUCTION_1 WITH (NOLOCK)
WHERE
    ActualCode =150
    AND Flg_Actual = 0
    AND Machine_No IN ('Start','END') 
),
BASE2 AS(
SELECT
    [INSERT_DATE]
    ,[INSERT_WEEK]
    ,[AB_SECTION_DAY]
    ,[Machine_Code]
    ,[Time_system]
    ,[Operater]
    ,[ActualCode]
    ,[Flg_Actual]
    ,[Machine_No]
    ,LAG([INSERT_DATE]) OVER (PARTITION BY [AB_SECTION_DAY],[Operater] ORDER BY INSERT_DATE)
    AS [PREVIOUS_DATE]
FROM BASE
)
SELECT
    [INSERT_DATE]
    ,[INSERT_WEEK]
    ,[AB_SECTION_DAY]
    ,[Machine_Code]
    ,[Time_system]
    ,[Operater]
    ,[ActualCode]
    ,[Flg_Actual]
    ,[Machine_No]
    ,CASE [Flg_Actual]
        WHEN 1 THEN 0
        ELSE DATEDIFF(MILLISECOND,[PREVIOUS_DATE],[INSERT_DATE]) /100
     END AS [Code_timer]
FROM BASE2

UNION

SELECT
    *
FROM
    AM307A_ACTUAL_PRODUCTION_1 WITH (NOLOCK)
WHERE
    ActualCode <> 150
GO